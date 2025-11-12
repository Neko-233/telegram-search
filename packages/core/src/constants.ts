// 消息处理批次大小
// 对于包含大量媒体的消息，应该使用较小的批次以避免内存占用过高
export const MESSAGE_PROCESS_BATCH_SIZE = 50
export const MESSAGE_RESOLVER_QUEUE_SIZE = 4

// LRU 缓存配置
export const MAX_AVATAR_CACHE_SIZE = 150
export const AVATAR_CACHE_TTL = 15 * 60 * 1000
export const AVATAR_DOWNLOAD_CONCURRENCY = 4

// 限制并发下载数量，避免同时下载过多文件导致内存爆炸
export const MEDIA_DOWNLOAD_CONCURRENCY = 32

// Telegram 历史记录请求节流（ms），避免触发 FloodWait
export const TELEGRAM_HISTORY_INTERVAL_MS = 1000
