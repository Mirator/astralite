// All sound is synthesized locally; no downloads or autoplay before a gesture.
export function createDungeonAudio() {
  let context: AudioContext | undefined, master: GainNode | undefined;
  // BASE is the master gain this game has always played at, so `level = 1` is exactly the old behaviour and
  // the slider only ever takes sound away. Mute is kept as its own flag rather than folded into the level:
  // un-muting has to return to whatever the player last chose, not to full.
  const BASE = 0.45;
  let muted = false, level = 1;
  const mix = () => muted ? 0 : BASE * level;
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
        context = new AudioContext(); master = context.createGain(); master.gain.value = mix(); master.connect(context.destination);
        // Quiet, beating low fifth supplies the cistern's ambient drone.
        for (const hz of [55, 82.5, 110.3]) { const o = context.createOscillator(), g = context.createGain(); o.frequency.value = hz; g.gain.value = 0.023; o.connect(g); g.connect(master); o.start(); }
      }
      void context.resume().catch(() => undefined);
    },
    // Both levers ramp rather than jump: a gain step on a running drone is an audible click. A change made
    // before the first gesture is simply remembered, because there is no context yet to ramp anything on.
    mute(value: boolean) { muted = value; if (context && master) master.gain.setTargetAtTime(mix(), context.currentTime, 0.04); },
    volume(value: number) { level = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : level; if (context && master) master.gain.setTargetAtTime(mix(), context.currentTime, 0.04); },
    // What the mixer is actually set to, for a driver that wants to see the lever moved rather than trust it.
    level: () => ({ volume: level, muted, target: mix(), gain: master?.gain.value ?? null, state: context?.state ?? 'none' }),
    pause(value: boolean) { if (context) void (value ? context.suspend() : context.resume()).catch(() => undefined); },
    play(kind: 'step' | 'slash' | 'hit' | 'hurt' | 'dash' | 'clear' | 'warn' | 'win' | 'lunge' | 'harpoon' | 'toll' | 'charge' | 'ready' | 'vault' | 'backstab' | 'whirl' | 'draw' | 'heavybolt' | 'flashpoint') {
      if (kind === 'step') tone(100, 0.065, 0.045, 40, 'triangle');
      if (kind === 'slash') tone(540, 0.13, 0.06, 80, 'triangle');
      if (kind === 'hit') { tone(170, 0.12, 0.18, 38, 'triangle'); tone(1100, 0.08, 0.035, 220, 'square'); }
      if (kind === 'hurt') tone(85, 0.28, 0.16, 28, 'sawtooth');
      if (kind === 'dash') tone(160, 0.18, 0.08, 600, 'triangle');
      if (kind === 'warn') tone(180, 0.18, 0.07, 240, 'triangle');
      // Plan 016: one voice per special, and a bright two-note ring when one comes back.
      if (kind === 'lunge') { tone(220, 0.22, 0.09, 900, 'sawtooth'); tone(640, 0.16, 0.04, 140, 'triangle', 0.05); }
      if (kind === 'harpoon') { tone(900, 0.2, 0.05, 260, 'triangle'); tone(120, 0.12, 0.06, 60, 'square', 0.02); }
      if (kind === 'toll') { tone(98, 0.9, 0.2, 60, 'sine'); tone(196, 0.7, 0.07, 190, 'triangle'); tone(58, 0.35, 0.14, 30, 'sawtooth'); }
      if (kind === 'charge') tone(70, 0.5, 0.05, 140, 'triangle');
      // Stage C: the hop's rush and the stab's bite are two sounds, because they are two moments.
      if (kind === 'vault') tone(300, 0.16, 0.06, 760, 'triangle');
      if (kind === 'backstab') { tone(1400, 0.07, 0.05, 300, 'square'); tone(150, 0.14, 0.14, 45, 'triangle'); }
      if (kind === 'whirl') { tone(260, 0.42, 0.07, 120, 'sawtooth'); tone(520, 0.36, 0.035, 1040, 'triangle', 0.08); }
      if (kind === 'draw') tone(90, 0.7, 0.04, 220, 'sawtooth');
      if (kind === 'heavybolt') { tone(70, 0.3, 0.2, 35, 'square'); tone(1800, 0.14, 0.04, 400, 'sawtooth'); }
      if (kind === 'flashpoint') { tone(60, 0.6, 0.22, 25, 'sawtooth'); tone(900, 0.25, 0.05, 120, 'triangle', 0.02); }
      if (kind === 'ready') { tone(880, 0.22, 0.035, 880, 'sine'); tone(1320, 0.3, 0.025, 1320, 'sine', 0.07); }
      if (kind === 'clear' || kind === 'win') [220, 330, 440, 660].forEach((f,i) => tone(f, 0.8, 0.09, f, 'sine', i * 0.14));
    },
    dispose() { if (context) void context.close().catch(() => undefined); },
  };
}
