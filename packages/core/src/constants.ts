// 消息处理批次大小
// 对于包含大量媒体的消息，应该使用较小的批次以避免内存占用过高
export const MESSAGE_PROCESS_BATCH_SIZE = 20
export const MESSAGE_PROCESS_LIMIT = 2

// 媒体处理批次大小 - 用于有媒体的消息
// 由于媒体文件（图片、贴纸等）占用内存较大，使用更小的批次
export const MEDIA_PROCESS_BATCH_SIZE = 5

// LRU 缓存配置
export const MAX_AVATAR_CACHE_SIZE = 120 // 降低峰值：最多缓存 120 个头像
export const AVATAR_CACHE_TTL = 10 * 60 * 1000 // 缩短生命周期：10 分钟过期（毫秒）
export const AVATAR_DOWNLOAD_CONCURRENCY = 6 // 收敛并发，降低内存峰值

// 限制并发下载数量，避免同时下载过多文件导致内存爆炸
export const MEDIA_DOWNLOAD_CONCURRENCY = 6
