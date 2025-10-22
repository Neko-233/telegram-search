import type { Api } from 'telegram'

import type { CoreContext } from '../context'
import type { TakeoutService } from '../services'

import { useLogger } from '@guiiai/logg'
import { usePagination } from '@tg-search/common'

import { MESSAGE_PROCESS_BATCH_SIZE } from '../constants'
import { getChatMessageStatsByChatId } from '../models'
import { createTask } from '../utils/task'

export function registerTakeoutEventHandlers(ctx: CoreContext) {
  const { emitter } = ctx
  const logger = useLogger('core:takeout:event')

  // Store active tasks by taskId for abort handling
  const activeTasks = new Map<string, ReturnType<typeof createTask>>()

  return (takeoutService: TakeoutService) => {
    emitter.on('takeout:run', async ({ chatIds, increase }) => {
      logger.withFields({ chatIds, increase }).verbose('Running takeout')
      const pagination = usePagination()

      // Get chat message stats for incremental sync
      const increaseOptions: { chatId: string, firstMessageId: number, latestMessageId: number, messageCount: number }[] = await Promise.all(
        chatIds.map(async (chatId) => {
          const stats = (await getChatMessageStatsByChatId(chatId))?.unwrap()
          return {
            chatId,
            firstMessageId: stats?.first_message_id ?? 0, // First synced message ID
            latestMessageId: stats?.latest_message_id ?? 0, // Latest synced message ID
            messageCount: stats?.message_count ?? 0, // Number of messages already in DB
          }
        }),
      )

      logger.withFields({ increaseOptions }).verbose('Chat message stats')

      let messages: Api.Message[] = []

      for (const chatId of chatIds) {
        const stats = increaseOptions.find(item => item.chatId === chatId)

        if (!increase) {
          // Full sync mode: sync all messages (overwrite)
          logger.withFields({ chatId, mode: 'full' }).verbose('Starting full sync')

          // Create task for full sync
          const task = createTask('takeout', { chatIds: [chatId] }, emitter)
          activeTasks.set(task.taskId, task)

          const opts = {
            pagination: {
              ...pagination,
              offset: 0,
            },
            minId: 0,
            maxId: 0,
            task,
          }

          for await (const message of takeoutService.takeoutMessages(chatId, opts)) {
            // Check abort signal before processing
            if (task.abortController.signal.aborted) {
              logger.verbose('Full sync aborted')
              break
            }

            messages.push(message)

            if (messages.length >= MESSAGE_PROCESS_BATCH_SIZE) {
              // Check abort signal before emitting
              if (task.abortController.signal.aborted) {
                logger.verbose('Full sync aborted during batch processing')
                break
              }

              emitter.emit('message:process', { messages, isTakeout: true })
              messages = []
            }
          }

          // Exit early if aborted
          if (task.abortController.signal.aborted) {
            logger.withFields({ chatId }).verbose('Full sync aborted')
            activeTasks.delete(task.taskId)
            continue
          }

          activeTasks.delete(task.taskId)
        }
        else {
          // Incremental sync mode: bidirectional fill (forward + backward)
          // Only sync if there are already some messages in the database
          if (!stats || (stats.firstMessageId === 0 && stats.latestMessageId === 0)) {
            logger.withFields({ chatId }).warn('No existing messages found, switching to full sync')

            // Create task for fallback full sync
            const task = createTask('takeout', { chatIds: [chatId] }, emitter)
            activeTasks.set(task.taskId, task)

            const opts = {
              pagination: {
                ...pagination,
                offset: 0,
              },
              minId: 0,
              maxId: 0,
              task,
            }

            for await (const message of takeoutService.takeoutMessages(chatId, opts)) {
              // Check abort signal before processing
              if (task.abortController.signal.aborted) {
                logger.verbose('Fallback full sync aborted')
                break
              }

              messages.push(message)

              if (messages.length >= MESSAGE_PROCESS_BATCH_SIZE) {
                // Check abort signal before emitting
                if (task.abortController.signal.aborted) {
                  logger.verbose('Fallback full sync aborted during batch processing')
                  break
                }

                emitter.emit('message:process', { messages, isTakeout: true })
                messages = []
              }
            }

            // Exit early if aborted
            if (task.abortController.signal.aborted) {
              logger.withFields({ chatId }).verbose('Fallback full sync aborted')
              activeTasks.delete(task.taskId)
              continue
            }

            activeTasks.delete(task.taskId)
          }
          else {
            // Incremental sync mode: bidirectional fill (backward + forward)
            // Calculate expected count: total messages - already synced messages

            // First, get total message count from Telegram
            const totalMessageCount = (await takeoutService.getTotalMessageCount(chatId)) ?? 0
            const alreadySyncedCount = stats.messageCount
            const needToSyncCount = Math.max(0, totalMessageCount - alreadySyncedCount)

            logger.withFields({
              chatId,
              totalMessages: totalMessageCount,
              alreadySynced: alreadySyncedCount,
              needToSync: needToSyncCount,
            }).verbose('Incremental sync calculation')

            // Create task for manual progress management
            const task = createTask('takeout', { chatIds: [chatId] }, emitter)
            activeTasks.set(task.taskId, task)
            task.updateProgress(0, 'Starting incremental sync')

            let totalProcessed = 0

            // Phase 1: Backward fill - sync messages after latest_message_id (newer messages)
            // For getting newer messages, we need to start from offsetId=0 (newest) and use minId filter
            logger.withFields({ chatId, mode: 'incremental-backward', minId: stats.latestMessageId }).verbose('Starting backward fill')
            const backwardOpts = {
              pagination: {
                ...pagination,
                offset: 0, // Start from the newest message
              },
              minId: stats.latestMessageId, // Filter: only get messages > latestMessageId
              maxId: 0,
              expectedCount: needToSyncCount, // This is the calculated number of messages that need to be synced for accurate progress tracking
              disableAutoProgress: true, // Disable auto progress to prevent reset between phases
              task, // Share task
            }

            let backwardMessageCount = 0
            for await (const message of takeoutService.takeoutMessages(chatId, backwardOpts)) {
              // Check abort signal before processing
              if (task.abortController.signal.aborted) {
                logger.verbose('Backward fill aborted')
                break
              }

              // Skip the latestMessageId itself (we already have it)
              if (message.id === stats.latestMessageId) {
                continue
              }

              messages.push(message)
              backwardMessageCount++
              totalProcessed++

              if (messages.length >= MESSAGE_PROCESS_BATCH_SIZE) {
                // Check abort signal before emitting
                if (task.abortController.signal.aborted) {
                  logger.verbose('Backward fill aborted during batch processing')
                  break
                }

                emitter.emit('message:process', { messages, isTakeout: true })
                messages = []

                // Emit progress update after batch processing
                const progress = needToSyncCount > 0 ? Number(((totalProcessed / needToSyncCount) * 100).toFixed(2)) : 0
                task.updateProgress(progress, `Processed ${totalProcessed}/${needToSyncCount} messages`)
              }
            }

            // Exit early if aborted
            if (task.abortController.signal.aborted) {
              logger.withFields({ chatId }).verbose('Incremental sync aborted')
              activeTasks.delete(task.taskId)
              return
            }

            logger.withFields({ chatId, count: backwardMessageCount }).verbose('Backward fill completed')

            // Phase 2: Forward fill - sync messages before first_message_id (older messages)
            // Start from the first synced message and go backwards (towards message ID 1)
            logger.withFields({ chatId, mode: 'incremental-forward', startFrom: stats.firstMessageId }).verbose('Starting forward fill')
            const forwardOpts = {
              pagination: {
                ...pagination,
                offset: stats.firstMessageId, // Start from first synced message
              },
              minId: 0, // No lower limit
              maxId: 0, // Will fetch older messages from offsetId
              expectedCount: needToSyncCount, // Use calculated count for accurate progress
              disableAutoProgress: true, // Disable auto progress to prevent reset between phases
              task, // Share task
            }

            let forwardMessageCount = 0
            for await (const message of takeoutService.takeoutMessages(chatId, forwardOpts)) {
              // Check abort signal before processing
              if (task.abortController.signal.aborted) {
                logger.verbose('Forward fill aborted')
                break
              }

              messages.push(message)
              forwardMessageCount++
              totalProcessed++

              if (messages.length >= MESSAGE_PROCESS_BATCH_SIZE) {
                // Check abort signal before emitting
                if (task.abortController.signal.aborted) {
                  logger.verbose('Forward fill aborted during batch processing')
                  break
                }

                emitter.emit('message:process', { messages, isTakeout: true })
                messages = []

                // Emit progress update after batch processing
                const progress = needToSyncCount > 0 ? Number(((totalProcessed / needToSyncCount) * 100).toFixed(2)) : 0
                task.updateProgress(progress, `Processed ${totalProcessed}/${needToSyncCount} messages`)
              }
            }

            // Exit early if aborted
            if (task.abortController.signal.aborted) {
              logger.withFields({ chatId }).verbose('Incremental sync aborted')
              activeTasks.delete(task.taskId)
              return
            }

            logger.withFields({ chatId, count: forwardMessageCount }).verbose('Forward fill completed')

            // Mark as complete
            task.updateProgress(100, 'Incremental sync completed')
            activeTasks.delete(task.taskId)
          }
        }
      }

      if (messages.length > 0) {
        emitter.emit('message:process', { messages, isTakeout: true })
      }
    })

    emitter.on('takeout:task:abort', ({ taskId }) => {
      logger.withFields({ taskId }).verbose('Aborting takeout task')
      const task = activeTasks.get(taskId)
      if (task) {
        task.abort()
        activeTasks.delete(taskId)
      }
      else {
        logger.withFields({ taskId }).warn('Task not found for abort')
      }
    })
  }
}
