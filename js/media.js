/**
 * MAtSapp Media – private storage + signed URLs
 */
const Media = (() => {
  const BUCKET = 'chat-media';
  const MAX_IMAGE_MB = 8;
  const MAX_DOC_MB = 15;
  const MAX_VOICE_MB = 5;

  function extFromMime(mime) {
    if (!mime) return 'bin';
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    if (mime.includes('pdf')) return 'pdf';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('mp4')) return 'mp4';
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'mp3';
    return 'bin';
  }

  async function resolveUrl(pathOrUrl) {
    if (!pathOrUrl) return null;
    // Already a full URL (legacy public)
    if (/^https?:\/\//i.test(pathOrUrl)) {
      if (!CONFIG.PRIVATE_MEDIA || !DB.supabase) return pathOrUrl;
      // Try extract path after bucket name for re-sign
      const marker = '/object/public/' + BUCKET + '/';
      const marker2 = '/object/sign/' + BUCKET + '/';
      let path = null;
      if (pathOrUrl.includes(marker)) path = pathOrUrl.split(marker)[1]?.split('?')[0];
      if (pathOrUrl.includes(marker2)) path = pathOrUrl.split(marker2)[1]?.split('?')[0];
      if (!path) return pathOrUrl;
      return signedUrl(path);
    }
    return signedUrl(pathOrUrl);
  }

  async function signedUrl(path) {
    if (!DB.supabase || !path) return null;
    if (!CONFIG.PRIVATE_MEDIA) {
      const { data } = DB.supabase.storage.from(BUCKET).getPublicUrl(path);
      return data && data.publicUrl;
    }
    const expires = CONFIG.SIGNED_URL_EXPIRES || 3600;
    const { data, error } = await DB.supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, expires);
    if (error) {
      console.warn('signedUrl', error.message);
      // fallback public
      const pub = DB.supabase.storage.from(BUCKET).getPublicUrl(path);
      return pub.data && pub.data.publicUrl;
    }
    return data.signedUrl;
  }

  async function uploadFile(file, folder, onProgress) {
    if (!DB.supabase) throw new Error('Storage not connected (Supabase required)');
    if (!file) throw new Error('No file');

    const sizeMb = file.size / (1024 * 1024);
    const mime = file.type || 'application/octet-stream';
    let kind = 'document';
    if (mime.startsWith('image/')) kind = 'image';
    else if (mime.startsWith('audio/') || mime.startsWith('video/')) kind = 'voice';

    if (kind === 'image' && sizeMb > MAX_IMAGE_MB) throw new Error('Image too large (max ' + MAX_IMAGE_MB + 'MB)');
    if (kind === 'document' && sizeMb > MAX_DOC_MB) throw new Error('File too large (max ' + MAX_DOC_MB + 'MB)');
    if (kind === 'voice' && sizeMb > MAX_VOICE_MB) throw new Error('Audio too large (max ' + MAX_VOICE_MB + 'MB)');

    const ext = extFromMime(mime);
    const path =
      (folder || 'misc') +
      '/' +
      Date.now() +
      '_' +
      Math.random().toString(36).slice(2, 8) +
      '.' +
      ext;

    if (onProgress) onProgress(0.1);

    const { data, error } = await DB.supabase.storage.from(BUCKET).upload(path, file, {
      contentType: mime,
      upsert: false
    });
    if (error) throw new Error(error.message || 'Upload failed');
    if (onProgress) onProgress(1);

    // Store path in DB; resolve signed URL for immediate display
    const url = await signedUrl(data.path);
    return {
      url,
      path: data.path,
      mime,
      size: file.size,
      type: kind
    };
  }

  async function compressImage(file, maxEdge = 1600, quality = 0.82) {
    if (!file.type.startsWith('image/')) return file;
    if (file.size < 400 * 1024) return file;
    return new Promise((resolve) => {
      const img = new Image();
      const obj = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxEdge || height > maxEdge) {
          const ratio = Math.min(maxEdge / width, maxEdge / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(obj);
            if (!blob) return resolve(file);
            resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => {
        URL.revokeObjectURL(obj);
        resolve(file);
      };
      img.src = obj;
    });
  }

  let recorder = null;
  let chunks = [];
  let startTime = 0;

  async function startVoice() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.start(200);
    startTime = Date.now();
    return stream;
  }

  function stopVoice() {
    return new Promise((resolve, reject) => {
      if (!recorder) return reject(new Error('Not recording'));
      recorder.onstop = () => {
        const mime = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mime });
        const duration = Math.round((Date.now() - startTime) / 1000);
        recorder.stream.getTracks().forEach((t) => t.stop());
        recorder = null;
        resolve({
          file: new File([blob], 'voice_' + Date.now() + '.webm', { type: mime }),
          duration
        });
      };
      recorder.stop();
    });
  }

  function isRecording() {
    return !!(recorder && recorder.state === 'recording');
  }

  return {
    uploadFile,
    compressImage,
    startVoice,
    stopVoice,
    isRecording,
    resolveUrl,
    signedUrl,
    BUCKET
  };
})();
