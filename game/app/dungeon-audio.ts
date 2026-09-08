// All sound is synthesized locally; no downloads or autoplay before a gesture.
export function createDungeonAudio() {
  let context: AudioContext | undefined, master: GainNode | undefined;
  let muted = false;
  const tone = (frequency: number, duration: number, volume: number, end = frequency, type: OscillatorType = 'sine', delay = 0) => {
    if (!context || !master || context.state !== 'running') return;
    const at = context.currentTime + delay, oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, at); oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), at + duration);
    gain.gain.setValueAtTime(0.001, at); gain.gain.exponentialRampToValueAtTime(volume, at + 0.012); gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain); gain.connect(master); oscillator.start(at); oscillator.stop(at + duration + 0.02); oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  };
  return {
    start() {
      if (!context) {
        context = new AudioContext(); master = context.createGain(); master.gain.value = muted ? 0 : 0.45; master.connect(context.destination);
        // Quiet, beating low fifth supplies the cistern's ambient drone.
        for (const hz of [55, 82.5, 110.3]) { const o = context.createOscillator(), g = context.createGain(); o.frequency.value = hz; g.gain.value = 0.023; o.connect(g); g.connect(master); o.start(); }
      }
      void context.resume().catch(() => undefined);
    },
    mute(value: boolean) { muted = value; if (context && master) master.gain.setTargetAtTime(value ? 0 : 0.45, context.currentTime, 0.04); },
    pause(value: boolean) { if (context) void (value ? context.suspend() : context.resume()).catch(() => undefined); },
    play(kind: 'step' | 'slash' | 'hit' | 'hurt' | 'dash' | 'clear' | 'warn' | 'win') {
      if (kind === 'step') tone(100, 0.065, 0.045, 40, 'triangle');
      if (kind === 'slash') tone(540, 0.13, 0.06, 80, 'triangle');
      if (kind === 'hit') { tone(170, 0.12, 0.18, 38, 'triangle'); tone(1100, 0.08, 0.035, 220, 'square'); }
      if (kind === 'hurt') tone(85, 0.28, 0.16, 28, 'sawtooth');
      if (kind === 'dash') tone(160, 0.18, 0.08, 600, 'triangle');
      if (kind === 'warn') tone(180, 0.18, 0.07, 240, 'triangle');
      if (kind === 'clear' || kind === 'win') [220, 330, 440, 660].forEach((f,i) => tone(f, 0.8, 0.09, f, 'sine', i * 0.14));
    },
    dispose() { if (context) void context.close().catch(() => undefined); },
  };
}
