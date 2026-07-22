import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {ABN, DataMark, IllustratedVisual, IllustratedVisualSpec, isIllustratedVisual} from './IllustratedScenes';

// ── Types ──────────────────────────────────────────────────────────────────────
export type Word = { text: string; start: number; end: number };
export type Cue = { icon: string; start: number; end: number };
export type VisualItem = { label: string; value: number; display: string; color?: string };
export type LinePoint = { x: number; y: number };
export type LineSeries = { name: string; color?: string; points: LinePoint[] };
export type BeatVisual = {
  type: 'number' | 'comparison' | 'chart' | 'line-chart' | 'source' | 'character' | 'journey' | 'household';
  title?: string;
  value?: string;
  subtitle?: string;
  src?: string;
  min?: number;
  max?: number;
  items?: VisualItem[];
  series?: LineSeries[];
  yMax?: number;
  ySuffix?: string;
  state?: string;
  tone?: 'costly' | 'balanced' | 'affordable';
} & Partial<IllustratedVisualSpec>;
export type Beat = {
  text: string;
  start: number;
  end: number;
  words: Word[];
  badge?: string;
  emoji?: string;
  visual?: BeatVisual;
};
export type ShortProps = {
  width: number;
  height: number;
  fps: number;
  totalSec: number;
  accent: string;
  audioSrc?: string; // filename inside public/
  sfxWord?: boolean;  // per-word sound (word.wav)
  sfxBadge?: boolean; // per-badge whoosh (whoosh.wav)
  music?: string | null; // background music filename inside public/
  brand?: string | null;
  cues?: Cue[];       // keyword-triggered graphics
  beats: Beat[];
};

const FONT = "'Inter', 'Arial Black', 'Segoe UI', sans-serif";

// ── Background: dark gradient + grid + drifting accent glow ──────────────────────
const BackgroundFX: React.FC<{ accent: string; light?: boolean }> = ({ accent, light }) => {
  const frame = useCurrentFrame();
  if (light) {
    const shift = (frame * 0.32) % 44;
    return (
      <AbsoluteFill style={{background: ABN.paper}}>
        <AbsoluteFill style={{backgroundImage: `linear-gradient(${ABN.ink}12 1px, transparent 1px), linear-gradient(90deg, ${ABN.ink}12 1px, transparent 1px)`, backgroundSize: '44px 44px', backgroundPosition: `${shift}px ${shift}px`}}/>
        <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: 22, background: ABN.ink}}/>
        <div style={{position: 'absolute', left: 22, top: 0, bottom: 0, width: 8, background: ABN.red}}/>
        <div style={{position: 'absolute', right: 34, top: 65, height: 510, width: 2, background: `${ABN.ink}35`}}/>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{position: 'absolute', right: 25, top: 78 + i * 110, width: 20, height: 4, background: i === 0 ? ABN.red : ABN.ink}}/>)}
        <div style={{position: 'absolute', left: 60, top: 46, width: 170, height: 10, display: 'grid', gridTemplateColumns: '3fr 2fr 1fr'}}><i style={{background: ABN.blue}}/><i style={{background: ABN.gold}}/><i style={{background: ABN.mint}}/></div>
      </AbsoluteFill>
    );
  }
  const { width, height } = useVideoConfig();
  const gx = width * (0.5 + 0.18 * Math.sin(frame / 90));
  const gy = height * (0.32 + 0.12 * Math.cos(frame / 110));
  return (
    <AbsoluteFill style={{ background: 'radial-gradient(circle at 50% 28%, #181826 0%, #0b0b0f 70%)' }}>
      <AbsoluteFill
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${gx}px ${gy}px, ${accent}22 0%, transparent 38%)`,
        }}
      />
    </AbsoluteFill>
  );
};

// ── Badge: "MISTAKE #1" pops in at the start of its beat ─────────────────────────
const Badge: React.FC<{ beat: Beat; accent: string }> = ({ beat, accent }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  if (!beat.badge) return null;
  const s = spring({ frame: frame - Math.round(beat.start * fps), fps, config: { damping: 12, stiffness: 160, mass: 0.7 } });
  const scale = interpolate(s, [0, 1], [0.3, 1]);
  return (
    <div style={{ position: 'absolute', top: height * 0.05, width: '100%', textAlign: 'center', opacity: s }}>
      <span
        style={{
          display: 'inline-block',
          transform: `scale(${scale}) rotate(-2deg)`,
          background: accent,
          color: '#0b0b0f',
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 60,
          letterSpacing: 2,
          padding: '14px 38px',
          borderRadius: 18,
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        {beat.badge}
        {beat.emoji ? `  ${beat.emoji}` : ''}
      </span>
    </div>
  );
};

// ── Kinetic captions: words pop in on their start time, active word highlighted ──
const Captions: React.FC<{ beat: Beat; t: number; accent: string; hasImage: boolean; light?: boolean }> = ({ beat, t, accent, hasImage, light }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  // No chart/number visual and no keyword icon showing → nothing occupies the
  // upper frame, so center the caption across the full height instead of
  // leaving it pinned to the lower half with dead space above it.
  const anchored = !!beat.visual || hasImage;
  return (
    <div
      style={{
        position: 'absolute',
        top: light ? '58%' : beat.visual ? '51%' : anchored ? '46%' : 0,
        bottom: anchored ? '8%' : 0,
        left: 0,
        right: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexWrap: 'wrap',
        alignContent: 'center',
        padding: `0 70px`,
        textAlign: 'center',
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: light ? 55 : beat.visual ? 64 : 82,
        lineHeight: 1.18,
        color: light ? '#17324d' : '#fff',
      }}
    >
      {beat.words.map((w, i) => {
        const wf = frame - Math.round(w.start * fps);
        if (wf < 0) return null;
        const s = spring({ frame: wf, fps, config: { damping: 11, stiffness: 150, mass: 0.6 } });
        const scale = interpolate(s, [0, 1], [0.4, 1]);
        const active = t >= w.start && t < w.end;
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              margin: '6px 12px',
              transform: `scale(${scale})`,
              color: active && !light ? '#0b0b0f' : light ? ABN.ink : '#fff',
              background: active && !light ? accent : 'transparent',
              boxShadow: active && light ? `inset 0 -13px 0 ${accent}` : 'none',
              padding: active && !light ? '0 16px' : '0',
              borderRadius: light ? 0 : 14,
              textShadow: active || light ? 'none' : '0 4px 22px rgba(0,0,0,0.55)',
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

// Data-first visual scenes. Narration stays in the lower half while the upper
// half carries the number, comparison, chart, or source being discussed.
const DataVisual: React.FC<{ beat: Beat; accent: string }> = ({ beat, accent }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const visual = beat.visual;
  if (!visual) return null;

  if (isIllustratedVisual(visual.type)) {
    return <IllustratedVisual visual={visual as IllustratedVisualSpec} beatStart={beat.start} beatEnd={beat.end}/>;
  }

  const localFrame = frame - Math.round(beat.start * fps);
  const enter = spring({ frame: localFrame, fps, config: { damping: 15, stiffness: 115, mass: 0.8 } });
  const opacity = interpolate(enter, [0, 1], [0, 1]);
  const rise = interpolate(enter, [0, 1], [42, 0]);
  const shell: React.CSSProperties = {
    position: 'absolute', top: 150, left: 64, right: 64, height: 720,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    opacity, transform: `translateY(${rise}px)`, fontFamily: FONT, color: ABN.ink,
  };

  if (visual.type === 'number') {
    return (
      <div style={shell}>
        <div style={{display: 'flex', alignItems: 'center', gap: 18, color: ABN.red, fontSize: 27, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 2, textAlign: 'center'}}><span style={{width: 54, height: 5, background: ABN.red}}/>{visual.title}<span style={{width: 54, height: 5, background: ABN.red}}/></div>
        <div style={{ marginTop: 26, padding: '22px 45px', border: `5px solid ${ABN.ink}`, boxShadow: `14px 14px 0 ${accent}`, fontSize: 142, lineHeight: 1, fontWeight: 950, color: ABN.ink }}>{visual.value}</div>
        {visual.subtitle ? <div style={{ marginTop: 38, maxWidth: 850, fontSize: 38, lineHeight: 1.2, fontWeight: 750, color: ABN.ink, textAlign: 'center' }}>{visual.subtitle}</div> : null}
      </div>
    );
  }

  if (visual.type === 'comparison') {
    const items = visual.items || [];
    const values = items.map((item) => item.value);
    const min = visual.min ?? Math.min(...values, 0);
    const max = visual.max ?? Math.max(...values, 1);
    return (
      <div style={{ ...shell, justifyContent: 'flex-start', paddingTop: 20 }}>
        <div style={{ fontSize: 42, fontWeight: 900, textAlign: 'center' }}>{visual.title}</div>
        <div style={{ width: '100%', marginTop: 42, display: 'flex', flexDirection: 'column', gap: 32 }}>
          {items.map((item, i) => {
            const target = Math.max(0.04, Math.min(1, (item.value - min) / Math.max(1, max - min)));
            const stagger = spring({ frame: localFrame - i * 6, fps, config: { damping: 16, stiffness: 105 } });
            return (
              <div key={`${item.label}-${i}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 35, fontWeight: 850 }}>
                  <span style={{color: ABN.ink}}>{item.label}</span><span style={{ color: item.color || accent, fontSize: 42 }}>{item.display}</span>
                </div>
                <div style={{ height: 42, marginTop: 10, background: `${ABN.ink}16`, border: `2px solid ${ABN.ink}`, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${target * 100 * stagger}%`, background: item.color || accent }} />
                </div>
              </div>
            );
          })}
        </div>
        {visual.subtitle ? <div style={{ marginTop: 38, fontSize: 38, fontWeight: 900, color: accent, textAlign: 'center' }}>{visual.subtitle}</div> : null}
      </div>
    );
  }

  if (visual.type === 'chart' && visual.src) {
    const zoom = interpolate(localFrame, [0, Math.max(1, (beat.end - beat.start) * fps)], [1, 1.045], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    return (
      <div style={{ ...shell, top: 115, height: 770 }}>
        {visual.title ? <div style={{ marginBottom: 22, fontSize: 38, fontWeight: 900, textAlign: 'center' }}>{visual.title}</div> : null}
        <div style={{ width: width - 110, height: 590, padding: 14, overflow: 'hidden', background: '#fff', border: `5px solid ${ABN.ink}`, boxShadow: `14px 14px 0 ${ABN.red}`, transform: `scale(${zoom})` }}>
          <Img src={staticFile(visual.src)} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      </div>
    );
  }

  if (visual.type === 'line-chart') {
    const series = visual.series || [];
    const allPoints = series.flatMap((item) => item.points || []);
    if (!allPoints.length) return null;
    const xMin = Math.min(...allPoints.map((point) => point.x));
    const xMax = Math.max(...allPoints.map((point) => point.x));
    const yMin = 0;
    const yMax = visual.yMax ?? Math.max(...allPoints.map((point) => point.y));
    const chartWidth = 900;
    const chartHeight = 520;
    const pad = { left: 74, right: 116, top: 42, bottom: 68 };
    const plotWidth = chartWidth - pad.left - pad.right;
    const plotHeight = chartHeight - pad.top - pad.bottom;
    const duration = Math.max(1, (beat.end - beat.start) * fps);
    const progress = interpolate(localFrame, [8, duration * 0.82], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
    const sx = (x: number) => pad.left + ((x - xMin) / Math.max(1, xMax - xMin)) * plotWidth;
    const sy = (y: number) => pad.top + plotHeight - ((y - yMin) / Math.max(1, yMax - yMin)) * plotHeight;
    const tickYears = [xMin, Math.round(xMin + (xMax - xMin) / 2), xMax];
    return (
      <div style={{ ...shell, top: 118, height: 760, justifyContent: 'flex-start' }}>
        {visual.title ? <div style={{ marginBottom: 18, fontSize: 39, fontWeight: 900, textAlign: 'center' }}>{visual.title}</div> : null}
        <div style={{ width: 950, padding: '20px 12px 8px', background: '#fff', border: `4px solid ${ABN.ink}`, boxShadow: `12px 12px 0 ${ABN.blue}` }}>
          <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
            {[0, 20, 40, 60].filter((tick) => tick <= yMax).map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={pad.left + plotWidth} y1={sy(tick)} y2={sy(tick)} stroke={`${ABN.ink}25`} strokeWidth="2" />
                <text x={pad.left - 14} y={sy(tick) + 8} textAnchor="end" fill={ABN.muted} fontSize="25" fontWeight="700">{tick}{visual.ySuffix || ''}</text>
              </g>
            ))}
            {tickYears.map((year) => <text key={year} x={sx(year)} y={chartHeight - 20} textAnchor="middle" fill={ABN.muted} fontSize="25" fontWeight="700">{year}</text>)}
            {series.map((item, index) => {
              const color = item.color || (index === 0 ? accent : '#ffffff');
              const pathData = item.points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'} ${sx(point.x)} ${sy(point.y)}`).join(' ');
              const last = item.points[item.points.length - 1];
              return (
                <g key={item.name}>
                  <path d={pathData} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} />
                  <g opacity={interpolate(progress, [0.78, 1], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}>
                    <circle cx={sx(last.x)} cy={sy(last.y)} r="9" fill={color} />
                    <text x={sx(last.x) - 16} y={sy(last.y) + 8} textAnchor="end" fill={color} fontSize="25" fontWeight="900">{item.name}</text>
                  </g>
                </g>
              );
            })}
          </svg>
        </div>
        {visual.subtitle ? <div style={{ marginTop: 22, fontSize: 32, fontWeight: 850, color: accent, textAlign: 'center' }}>{visual.subtitle}</div> : null}
      </div>
    );
  }

  return (
    <div style={shell}>
      <DataMark size={88}/>
      <div style={{ marginTop: 22, color: ABN.red, fontSize: 24, fontWeight: 900, letterSpacing: 3, textTransform: 'uppercase' }}>Evidence ledger / source</div>
      <div style={{ marginTop: 22, maxWidth: 880, fontSize: 60, lineHeight: 1.1, fontWeight: 950, textAlign: 'center', color: ABN.ink }}>{visual.title}</div>
      {visual.subtitle ? <div style={{ marginTop: 28, paddingTop: 22, borderTop: `4px solid ${ABN.ink}`, fontSize: 31, color: ABN.muted, fontWeight: 750, textAlign: 'center' }}>{visual.subtitle}</div> : null}
    </div>
  );
};

// ── Progress bar ─────────────────────────────────────────────────────────────────
const ProgressBar: React.FC<{ t: number; total: number; accent: string; light?: boolean }> = ({ t, total, accent, light }) => (
  <div style={{ position: 'absolute', bottom: 70, left: '8%', width: '84%', height: 10, background: light ? `${ABN.ink}20` : 'rgba(255,255,255,0.14)' }}>
    <div style={{ width: `${Math.min(100, (t / total) * 100)}%`, height: '100%', background: accent }} />
  </div>
);

// ── Sound effects: a soft pop per word, a whoosh per badge ───────────────────────
const SoundFX: React.FC<{ beats: Beat[]; word: boolean; badge: boolean }> = ({ beats, word, badge }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {beats.map((b, bi) => (
        <React.Fragment key={bi}>
          {badge ? (
            <Sequence from={Math.max(0, Math.round(b.start * fps))} durationInFrames={Math.round(0.5 * fps)}>
              <Audio src={staticFile('whoosh.wav')} volume={0.4} />
            </Sequence>
          ) : null}
          {word
            ? b.words.map((w, wi) => (
                <Sequence key={wi} from={Math.max(0, Math.round(w.start * fps))} durationInFrames={Math.round(0.25 * fps)}>
                  <Audio src={staticFile('word.wav')} volume={0.18} />
                </Sequence>
              ))
            : null}
        </React.Fragment>
      ))}
    </>
  );
};

// ── Background music: low bed with fade in / out so it sits under the voice ──────
const MusicBed: React.FC<{ src: string }> = ({ src }) => {
  const { durationInFrames } = useVideoConfig();
  const out = Math.max(26, durationInFrames - 45);
  return (
    <Audio
      src={staticFile(src)}
      loop
      volume={(f) => interpolate(f, [0, 25, out, durationInFrames], [0, 0.08, 0.08, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
    />
  );
};

const BrandMark: React.FC<{ name?: string | null; accent: string; light?: boolean }> = ({ name, accent, light }) => {
  if (!name) return null;
  return (
    <div style={{ position: 'absolute', left: 48, bottom: 18, display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT, color: light ? ABN.ink : '#d7d9e0' }}>
      {light ? <DataMark size={43}/> : <span style={{ width: 12, height: 12, borderRadius: '50%', background: accent, boxShadow: `0 0 18px ${accent}` }} />}
      <span style={{display: 'flex', flexDirection: 'column', lineHeight: 1}}><b style={{fontSize: 21, fontWeight: 950, letterSpacing: 1.1}}>{name}</b>{light ? <small style={{marginTop: 5, color: ABN.red, fontSize: 12, fontWeight: 900, letterSpacing: 2}}>PUBLIC DATA / CLEAR CONTEXT</small> : null}</span>
    </div>
  );
};

// Seconds a keyword image lingers after its keyword is spoken — shared so the
// caption layout can agree with KeywordGraphics on when an image is on screen.
const IMAGE_HOLD = 2.2;

// ── Keyword graphics: an icon card pops in when its keyword is spoken ─────────────
const KeywordGraphics: React.FC<{ cues: Cue[]; accent: string }> = ({ cues, accent }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const HOLD = IMAGE_HOLD; // seconds the image lingers after its keyword is spoken
  return (
    <>
      {cues.map((c, i) => {
        if (t < c.start || t > c.end + HOLD) return null;
        const s = spring({ frame: frame - Math.round(c.start * fps), fps, config: { damping: 13, stiffness: 140, mass: 0.7 } });
        const fade = interpolate(t, [c.end + HOLD - 0.3, c.end + HOLD], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const scale = interpolate(s, [0, 1], [0.4, 1]);
        return (
          <div key={i} style={{ position: 'absolute', top: height * 0.14, left: 0, right: 0, display: 'flex', justifyContent: 'center', opacity: Math.min(s, fade) }}>
            <div style={{ width: 480, height: 480, borderRadius: 40, overflow: 'hidden', transform: `scale(${scale})`, border: `5px solid ${accent}`, boxShadow: '0 24px 70px rgba(0,0,0,0.65)' }}>
              <Img src={staticFile(c.icon)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            </div>
          </div>
        );
      })}
    </>
  );
};

// ── Composition ──────────────────────────────────────────────────────────────────
export const FacelessShort: React.FC<ShortProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const beat = props.beats.find((b) => t >= b.start && t < b.end) ?? props.beats[props.beats.length - 1];
  const hasImage = (props.cues || []).some((c) => t >= c.start && t <= c.end + IMAGE_HOLD);
  const branded = !!beat.visual;

  return (
    <AbsoluteFill>
      {props.audioSrc ? <Audio src={staticFile(props.audioSrc)} /> : null}
      {props.music ? <MusicBed src={props.music} /> : null}
      {(props.sfxWord || props.sfxBadge) ? <SoundFX beats={props.beats} word={!!props.sfxWord} badge={!!props.sfxBadge} /> : null}
      <BackgroundFX accent={props.accent} light={branded} />
      {!beat.visual ? <KeywordGraphics cues={props.cues || []} accent={props.accent} /> : null}
      <DataVisual beat={beat} accent={props.accent} />
      <Badge beat={beat} accent={props.accent} />
      <Captions beat={beat} t={t} accent={props.accent} hasImage={hasImage} light={branded} />
      <ProgressBar t={t} total={props.totalSec} accent={props.accent} light={branded} />
      <BrandMark name={props.brand} accent={props.accent} light={branded} />
    </AbsoluteFill>
  );
};

// ── Sample data so the composition renders standalone (no pipeline needed) ────────
const mk = (text: string, badge: string, emoji: string, start: number, end: number): Beat => {
  const ws = text.split(' ');
  const span = (end - 0.3 - start) / ws.length;
  return {
    text, badge, emoji, start, end,
    words: ws.map((w, i) => ({ text: w, start: start + i * span, end: start + (i + 1) * span })),
  };
};

export const defaultProps: ShortProps = {
  width: 1080,
  height: 1920,
  fps: 30,
  totalSec: 9,
  accent: '#ffd23f',
  beats: [
    mk('Your first layer prints too fast', 'MISTAKE #1', '🔥', 0, 3.0),
    mk("Your bed isn't actually level", 'MISTAKE #2', '⚠️', 3.0, 6.0),
    mk("You're ignoring filament moisture", 'MISTAKE #3', '💧', 6.0, 9.0),
  ],
};
