/**
 * MAtSapp Phase 5 – WebRTC 1:1 voice/video
 * Signaling via Supabase Realtime broadcast channels.
 * Uses public STUN; for difficult NATs you need a TURN server.
 */
const Calls = (() => {
  function getIceConfig() {
    const servers = (typeof CONFIG !== 'undefined' && CONFIG.ICE_SERVERS) || [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];
    return { iceServers: servers };
  }

  let pc = null;
  let localStream = null;
  let remoteStream = null;
  let signalChannel = null;
  let currentCall = null; // { id, type, role, peerPhone }
  let callTimer = null;
  let callSeconds = 0;
  let onState = null;

  function setState(state, extra) {
    if (typeof onState === 'function') onState(state, extra);
  }

  async function ensureMedia(video) {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: video ? { facingMode: 'user' } : false
    });
    return localStream;
  }

  function createPeer() {
    pc = new RTCPeerConnection(getIceConfig());
    remoteStream = new MediaStream();

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.ontrack = (ev) => {
      ev.streams[0].getTracks().forEach((t) => remoteStream.addTrack(t));
      setState('remote-stream', { stream: remoteStream });
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate && signalChannel && currentCall) {
        signalChannel.send({
          type: 'broadcast',
          event: 'signal',
          payload: {
            kind: 'ice',
            callId: currentCall.id,
            from: currentCall.me,
            candidate: ev.candidate
          }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        startTimer();
        setState('connected');
      }
      if (s === 'failed' || s === 'disconnected' || s === 'closed') {
        setState('ended', { reason: s });
      }
    };

    return pc;
  }

  function startTimer() {
    callSeconds = 0;
    if (callTimer) clearInterval(callTimer);
    callTimer = setInterval(() => {
      callSeconds += 1;
      setState('tick', { seconds: callSeconds });
    }, 1000);
  }

  function stopTimer() {
    if (callTimer) clearInterval(callTimer);
    callTimer = null;
  }

  async function openSignal(me) {
    if (!DB.supabase) throw new Error('Supabase required for calls');
    if (signalChannel) return signalChannel;

    signalChannel = DB.supabase.channel('calls-signal:' + me, {
      config: { broadcast: { self: false } }
    });

    signalChannel
      .on('broadcast', { event: 'signal' }, async ({ payload }) => {
        if (!payload) return;
        // Incoming offer (ring)
        if (payload.kind === 'offer' && payload.to === me) {
          currentCall = {
            id: payload.callId,
            type: payload.callType || 'voice',
            role: 'callee',
            peerPhone: payload.from,
            me
          };
          setState('incoming', {
            from: payload.from,
            type: payload.callType,
            offer: payload.sdp,
            callId: payload.callId
          });
          return;
        }

        if (!currentCall || payload.callId !== currentCall.id) return;

        if (payload.kind === 'answer' && currentCall.role === 'caller') {
          await pc.setRemoteDescription(payload.sdp);
        }
        if (payload.kind === 'ice' && payload.candidate) {
          try {
            await pc.addIceCandidate(payload.candidate);
          } catch (e) {
            console.warn('ICE add failed', e);
          }
        }
        if (payload.kind === 'hangup') {
          await endCall(false);
          setState('ended', { reason: 'remote-hangup' });
        }
        if (payload.kind === 'reject') {
          await endCall(false);
          setState('ended', { reason: 'rejected' });
        }
      })
      .subscribe();

    return signalChannel;
  }

  async function startCall({ me, peerPhone, type }) {
    await openSignal(me);
    await ensureMedia(type === 'video');
    createPeer();

    const callId = 'call_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    currentCall = { id: callId, type, role: 'caller', peerPhone, me };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Notify peer on THEIR channel
    const peerChannel = DB.supabase.channel('calls-signal:' + peerPhone, {
      config: { broadcast: { self: false } }
    });
    await peerChannel.subscribe();
    await peerChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: {
        kind: 'offer',
        callId,
        callType: type,
        from: me,
        to: peerPhone,
        sdp: offer
      }
    });
    // keep peer channel briefly then remove
    setTimeout(() => DB.supabase.removeChannel(peerChannel), 5000);

    if (DB.supabase) {
      DB.supabase.from('calls').insert({
        id: callId.length === 36 ? callId : undefined,
        caller_phone: me,
        callee_phone: peerPhone,
        type,
        status: 'ringing'
      }).then(() => {});
    }

    setState('outgoing', { to: peerPhone, type, localStream });
    return callId;
  }

  async function acceptCall({ me, offer, callId, from, type }) {
    await openSignal(me);
    await ensureMedia(type === 'video');
    createPeer();
    currentCall = { id: callId, type, role: 'callee', peerPhone: from, me };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    const peerChannel = DB.supabase.channel('calls-signal:' + from);
    await peerChannel.subscribe();
    await peerChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: { kind: 'answer', callId, from: me, sdp: answer }
    });
    setTimeout(() => DB.supabase.removeChannel(peerChannel), 3000);

    setState('outgoing', { to: from, type, localStream }); // shows local preview
    setState('accepted');
  }

  async function rejectCall({ me, callId, from }) {
    const peerChannel = DB.supabase.channel('calls-signal:' + from);
    await peerChannel.subscribe();
    await peerChannel.send({
      type: 'broadcast',
      event: 'signal',
      payload: { kind: 'reject', callId, from: me }
    });
    setTimeout(() => DB.supabase.removeChannel(peerChannel), 2000);
    currentCall = null;
    setState('ended', { reason: 'rejected-by-me' });
  }

  async function endCall(notifyPeer = true) {
    stopTimer();
    if (notifyPeer && currentCall && DB.supabase) {
      try {
        const peerChannel = DB.supabase.channel('calls-signal:' + currentCall.peerPhone);
        await peerChannel.subscribe();
        await peerChannel.send({
          type: 'broadcast',
          event: 'signal',
          payload: { kind: 'hangup', callId: currentCall.id, from: currentCall.me }
        });
        setTimeout(() => DB.supabase.removeChannel(peerChannel), 2000);
      } catch (_) {}
    }
    if (pc) {
      try { pc.close(); } catch (_) {}
      pc = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    remoteStream = null;
    currentCall = null;
  }

  function toggleMute() {
    if (!localStream) return false;
    const track = localStream.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }

  function toggleCamera() {
    if (!localStream) return false;
    const track = localStream.getVideoTracks()[0];
    if (!track) return false;
    track.enabled = !track.enabled;
    return !track.enabled;
  }

  async function init(me, stateCb) {
    onState = stateCb;
    if (me) await openSignal(me);
  }

  return {
    init,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    get localStream() { return localStream; },
    get remoteStream() { return remoteStream; },
    get currentCall() { return currentCall; }
  };
})();
