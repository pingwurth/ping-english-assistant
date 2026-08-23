/** 文件工具：扩展名校验等 */

const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'];
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
const SUBTITLE_EXT = ['srt', 'lrc'];

export function extOf(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() ?? '';
}

export function isAudioFile(fileName: string): boolean {
  return AUDIO_EXT.includes(extOf(fileName));
}

export function isVideoFile(fileName: string): boolean {
  return VIDEO_EXT.includes(extOf(fileName));
}

export function isMediaFile(fileName: string): boolean {
  return isAudioFile(fileName) || isVideoFile(fileName);
}

export function isSubtitleFile(fileName: string): boolean {
  return SUBTITLE_EXT.includes(extOf(fileName));
}

export function mediaTypeOf(fileName: string): 'video' | 'audio' {
  return isVideoFile(fileName) ? 'video' : 'audio';
}

/** 去除扩展名 */
export function baseNameOf(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}
