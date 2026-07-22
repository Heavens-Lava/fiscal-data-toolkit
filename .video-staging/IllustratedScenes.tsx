import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

type Item = {label: string; value: number; display: string; color?: string};

export type IllustratedVisualSpec = {
  type: 'character' | 'journey' | 'household';
  title?: string;
  value?: string;
  subtitle?: string;
  state?: string;
  tone?: 'costly' | 'balanced' | 'affordable';
  items?: Item[];
};

export const ABN = {
  ink: '#102a43',
  paper: '#f7f2e8',
  blue: '#1769aa',
  red: '#df5547',
  mint: '#168c83',
  gold: '#e7ad35',
  sky: '#9fc9d8',
  lavender: '#7470b7',
  muted: '#587085',
  line: '#cad2d2',
};

const FONT = "'Inter', 'Arial Black', 'Segoe UI', sans-serif";

export const isIllustratedVisual = (type?: string) =>
  type === 'character' || type === 'journey' || type === 'household';

const enterSpring = (frame: number, fps: number, delay = 0) =>
  spring({frame: frame - delay, fps, config: {damping: 15, stiffness: 125, mass: 0.78}});

const stateCode = (state?: string) => ({
  California: 'CA', Arizona: 'AZ', Arkansas: 'AR',
}[state || ''] || (state || 'US').slice(0, 2).toUpperCase());

export const DataMark: React.FC<{size?: number; inverse?: boolean}> = ({size = 54, inverse}) => {
  const ink = inverse ? ABN.paper : ABN.ink;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" fill={ink}/>
      <rect x="12" y="35" width="9" height="17" fill={ABN.red}/>
      <rect x="27" y="25" width="9" height="27" fill={ABN.gold}/>
      <rect x="42" y="13" width="9" height="39" fill={ABN.mint}/>
      <path d="M12 18h18" stroke={inverse ? ABN.ink : ABN.paper} strokeWidth="5"/>
    </svg>
  );
};

const SceneHeader: React.FC<{title?: string; subtitle?: string; index?: string}> = ({title, subtitle, index = 'DATA NOTE'}) => (
  <div style={{position: 'absolute', top: 6, left: 16, right: 16, fontFamily: FONT}}>
    <div style={{display: 'flex', alignItems: 'center', gap: 14}}>
      <span style={{fontSize: 20, fontWeight: 900, color: ABN.red, letterSpacing: 2.2}}>{index}</span>
      <span style={{height: 3, flex: 1, background: ABN.ink}}/>
      <span style={{display: 'flex', gap: 5}}>
        {[ABN.red, ABN.gold, ABN.mint].map((color) => <i key={color} style={{display: 'block', width: 9, height: 9, background: color}}/>)}
      </span>
    </div>
    <div style={{marginTop: 18, maxWidth: 900, fontSize: 47, lineHeight: 1.03, fontWeight: 950, color: ABN.ink, letterSpacing: 0}}>{title}</div>
    {subtitle ? <div style={{marginTop: 12, maxWidth: 860, fontSize: 25, lineHeight: 1.25, fontWeight: 750, color: ABN.muted}}>{subtitle}</div> : null}
  </div>
);

const DataPerson: React.FC<{frame: number; tone?: string; walking?: boolean; small?: boolean}> = ({frame, tone, walking, small}) => {
  const bob = Math.sin(frame / 5.5) * (walking ? 8 : 2.5);
  const swing = Math.sin(frame / 5.5) * (walking ? 18 : 4);
  const main = tone === 'costly' ? ABN.red : tone === 'affordable' ? ABN.mint : ABN.gold;
  const face = tone === 'costly' ? 'M77 73q15-11 30 0' : 'M77 69q15 13 30 0';
  const width = small ? 180 : 260;
  const height = small ? 360 : 520;
  return (
    <svg viewBox="0 0 190 390" width={width} height={height} style={{transform: `translateY(${bob}px)`}} aria-hidden="true">
      <circle cx="95" cy="57" r="45" fill={ABN.sky}/>
      <path d="M95 12a45 45 0 0 1 42 29L95 57z" fill={ABN.red}/>
      <path d="M95 12v45H50A45 45 0 0 1 95 12z" fill={ABN.gold}/>
      <circle cx="78" cy="60" r="4" fill={ABN.ink}/><circle cx="111" cy="60" r="4" fill={ABN.ink}/>
      <path d={face} fill="none" stroke={ABN.ink} strokeWidth="5" strokeLinecap="round"/>
      <rect x="47" y="112" width="96" height="49" fill={main}/>
      <rect x="47" y="166" width="96" height="35" fill={ABN.blue}/>
      <rect x="47" y="206" width="96" height="46" fill={ABN.ink}/>
      <g transform={`rotate(${swing} 47 124)`}><path d="M42 124v124" stroke={ABN.ink} strokeWidth="24" strokeLinecap="square"/></g>
      <g transform={`rotate(${-swing} 143 124)`}><path d="M148 124v124" stroke={ABN.ink} strokeWidth="24" strokeLinecap="square"/></g>
      <g transform={`rotate(${-swing * 0.5} 72 251)`}><path d="M72 250v113" stroke={ABN.ink} strokeWidth="30" strokeLinecap="square"/></g>
      <g transform={`rotate(${swing * 0.5} 118 251)`}><path d="M118 250v113" stroke={ABN.ink} strokeWidth="30" strokeLinecap="square"/></g>
      <path d="M55 220h80" stroke={ABN.paper} strokeWidth="4" strokeDasharray="7 7"/>
    </svg>
  );
};

const ValueLedger: React.FC<{value?: string; label?: string; color: string; frame: number; fps: number}> = ({value, label, color, frame, fps}) => {
  const enter = enterSpring(frame, fps, 5);
  return (
    <div style={{position: 'relative', width: 518, background: '#fff', border: `4px solid ${ABN.ink}`, boxShadow: `14px 14px 0 ${color}`, opacity: enter, transform: `translateX(${interpolate(enter, [0, 1], [45, 0])}px)`}}>
      <div style={{display: 'grid', gridTemplateColumns: '64px 1fr'}}>
        <div style={{background: ABN.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontFamily: FONT, fontWeight: 900, fontSize: 16, letterSpacing: 2}}>BUYING POWER</div>
        <div style={{padding: '28px 25px 22px', textAlign: 'left'}}>
          <div style={{fontFamily: FONT, fontSize: 82, lineHeight: 1, fontWeight: 950, color: ABN.ink}}>{value}</div>
          <div style={{marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT, color, fontSize: 31, fontWeight: 950}}>
            <span style={{width: 25, height: 7, background: color}}/>{label}
          </div>
        </div>
      </div>
      <div style={{height: 12, display: 'grid', gridTemplateColumns: '3fr 2fr 1fr'}}><i style={{background: ABN.blue}}/><i style={{background: ABN.gold}}/><i style={{background: ABN.red}}/></div>
    </div>
  );
};

const StatePlate: React.FC<{item: Item; index: number; frame: number; fps: number}> = ({item, index, frame, fps}) => {
  const pop = enterSpring(frame, fps, index * 7);
  const color = item.color || [ABN.mint, ABN.gold, ABN.red][index];
  return (
    <div style={{width: 262, background: ABN.paper, border: `4px solid ${ABN.ink}`, boxShadow: `10px 10px 0 ${color}`, opacity: pop, transform: `translateY(${interpolate(pop, [0, 1], [35, 0])}px)`}}>
      <div style={{display: 'flex', alignItems: 'stretch'}}>
        <div style={{width: 72, padding: '16px 5px', background: color, color: ABN.ink, fontFamily: FONT, fontSize: 24, fontWeight: 950, textAlign: 'center'}}>{stateCode(item.label)}</div>
        <div style={{padding: '12px 14px', fontFamily: FONT}}>
          <div style={{fontSize: 22, fontWeight: 900, color: ABN.ink}}>{item.label}</div>
          <div style={{fontSize: 30, fontWeight: 950, color}}>{item.display}</div>
        </div>
      </div>
    </div>
  );
};

const CharacterScene: React.FC<{visual: IllustratedVisualSpec; frame: number; fps: number}> = ({visual, frame, fps}) => {
  const enter = enterSpring(frame, fps);
  const color = visual.tone === 'costly' ? ABN.red : visual.tone === 'affordable' ? ABN.mint : ABN.gold;
  return (
    <div style={{position: 'absolute', inset: '112px 48px 805px', fontFamily: FONT, opacity: enter}}>
      <SceneHeader title={visual.title} subtitle={visual.subtitle} index="PRICE LEVEL / 01"/>
      <div style={{position: 'absolute', left: 12, bottom: -15}}><DataPerson frame={frame} tone={visual.tone}/></div>
      <div style={{position: 'absolute', right: 0, top: 352}}><ValueLedger value={visual.value} label={visual.state} color={color} frame={frame} fps={fps}/></div>
      <div style={{position: 'absolute', left: 255, top: 300, width: 175, height: 175, border: `3px solid ${ABN.ink}`, borderRadius: '50%'}}>
        <svg viewBox="0 0 100 100" width="100%" height="100%"><circle cx="50" cy="50" r="37" fill="none" stroke={ABN.line} strokeWidth="15"/><path d="M50 13a37 37 0 0 1 34 23" fill="none" stroke={color} strokeWidth="15"/><text x="50" y="62" textAnchor="middle" fontFamily={FONT} fontWeight="950" fontSize="34" fill={ABN.ink}>$</text></svg>
      </div>
    </div>
  );
};

const JourneyScene: React.FC<{visual: IllustratedVisualSpec; frame: number; fps: number; duration: number}> = ({visual, frame, fps, duration}) => {
  const items = visual.items || [];
  const travel = interpolate(frame, [8, Math.max(12, duration - 14)], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const positions = [{left: 15, top: 590}, {left: 345, top: 405}, {left: 680, top: 220}];
  return (
    <div style={{position: 'absolute', inset: '112px 48px 805px', fontFamily: FONT}}>
      <SceneHeader title={visual.title} subtitle={visual.subtitle} index="STATE COMPARISON / 02"/>
      <svg style={{position: 'absolute', left: 70, top: 238}} width="820" height="520" viewBox="0 0 820 520">
        <path d="M75 420 C255 330 355 250 735 55" fill="none" stroke={ABN.ink} strokeWidth="5"/>
        <path d="M75 420 C255 330 355 250 735 55" fill="none" stroke={ABN.paper} strokeWidth="2" strokeDasharray="8 10"/>
        {[0, 0.5, 1].map((x) => <rect key={x} x={interpolate(x, [0, 1], [70, 730])} y={interpolate(x, [0, 1], [415, 50])} width="13" height="13" fill={ABN.red} transform={`rotate(45 ${interpolate(x, [0, 1], [76, 736])} ${interpolate(x, [0, 1], [421, 56])})`}/>)}
      </svg>
      {items.slice(0, 3).map((item, i) => <div key={item.label} style={{position: 'absolute', ...positions[i]}}><StatePlate item={item} index={i} frame={frame} fps={fps}/></div>)}
      <div style={{position: 'absolute', left: interpolate(travel, [0, 1], [120, 700]), top: interpolate(travel, [0, 1], [500, 140]), transform: 'scale(0.48)', transformOrigin: 'center'}}><DataPerson frame={frame} tone="balanced" walking small/></div>
      {visual.value ? <div style={{position: 'absolute', left: 245, bottom: -8, padding: '17px 28px', background: ABN.ink, borderLeft: `13px solid ${ABN.red}`, color: '#fff', fontSize: 42, fontWeight: 950}}>{visual.value}</div> : null}
    </div>
  );
};

const CategoryGlyph: React.FC<{kind: string; color: string}> = ({kind, color}) => {
  if (/housing/i.test(kind)) return <svg viewBox="0 0 100 90" width="82" height="74"><path d="M8 43L50 8l42 35v40H8z" fill={color}/><rect x="39" y="51" width="22" height="32" fill={ABN.paper}/><path d="M3 44L50 4l47 40" fill="none" stroke={ABN.ink} strokeWidth="7"/></svg>;
  if (/transport/i.test(kind)) return <svg viewBox="0 0 110 70" width="90" height="62"><path d="M17 43l12-25h55l14 25" fill={color}/><rect x="7" y="38" width="96" height="22" fill={color}/><circle cx="29" cy="61" r="8" fill={ABN.ink}/><circle cx="82" cy="61" r="8" fill={ABN.ink}/></svg>;
  if (/food/i.test(kind)) return <svg viewBox="0 0 90 90" width="76" height="76"><path d="M10 34h70L67 81H23z" fill={color}/><path d="M27 36q2-27 18-27t18 27" fill="none" stroke={ABN.ink} strokeWidth="7"/></svg>;
  return <svg viewBox="0 0 90 90" width="76" height="76"><circle cx="45" cy="45" r="37" fill={color}/><path d="M45 18v54M20 45h50" stroke={ABN.paper} strokeWidth="9"/><circle cx="45" cy="45" r="11" fill={ABN.ink}/></svg>;
};

const HouseholdScene: React.FC<{visual: IllustratedVisualSpec; frame: number; fps: number}> = ({visual, frame, fps}) => {
  const items = visual.items || [];
  const colors = [ABN.red, ABN.mint, ABN.gold, ABN.lavender];
  const positions = [{left: 2, top: 330}, {right: 2, top: 330}, {left: 2, top: 600}, {right: 2, top: 600}];
  return (
    <div style={{position: 'absolute', inset: '112px 48px 805px', fontFamily: FONT}}>
      <SceneHeader title={visual.title} subtitle={visual.subtitle} index="HOUSEHOLD LEDGER / 03"/>
      <div style={{position: 'absolute', left: 365, top: 330, width: 245, height: 430, border: `4px solid ${ABN.ink}`, background: '#fff', display: 'flex', flexDirection: 'column-reverse', padding: 12, gap: 7}}>
        {[0.25, 0.2, 0.3, 0.16].map((height, i) => {
          const grow = enterSpring(frame, fps, i * 5);
          return <div key={i} style={{height: `${height * 100 * grow}%`, minHeight: 30, background: colors[i], display: 'flex', alignItems: 'center', justifyContent: 'center', color: i === 2 ? ABN.ink : '#fff', fontSize: 20, fontWeight: 950}}>{String(i + 1).padStart(2, '0')}</div>;
        })}
        <div style={{position: 'absolute', left: -4, right: -4, top: -48, height: 44, background: ABN.ink, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 900, letterSpacing: 2}}>COST STACK</div>
      </div>
      {items.slice(0, 4).map((item, i) => {
        const color = item.color || colors[i];
        const pop = enterSpring(frame, fps, i * 6);
        return (
          <div key={item.label} style={{position: 'absolute', ...positions[i], width: 272, height: 210, background: ABN.paper, border: `4px solid ${ABN.ink}`, boxShadow: `8px 8px 0 ${color}`, padding: '14px 16px', opacity: pop, transform: `translateY(${interpolate(pop, [0, 1], [32, 0])}px)`}}>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'}}><CategoryGlyph kind={item.label} color={color}/><span style={{fontSize: 19, fontWeight: 950, color: ABN.muted}}>{String(i + 1).padStart(2, '0')}</span></div>
            <div style={{fontSize: 24, fontWeight: 950, color: ABN.ink}}>{item.label}</div>
            <div style={{marginTop: 5, fontSize: 25, fontWeight: 850, color}}>{item.display}</div>
          </div>
        );
      })}
      {visual.value ? <div style={{position: 'absolute', left: 320, right: 320, bottom: -5, padding: '15px 8px', background: ABN.blue, color: '#fff', textAlign: 'center', fontSize: 31, fontWeight: 950}}>{visual.value}</div> : null}
    </div>
  );
};

export const IllustratedVisual: React.FC<{visual: IllustratedVisualSpec; beatStart: number; beatEnd: number}> = ({visual, beatStart, beatEnd}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const localFrame = frame - Math.round(beatStart * fps);
  const duration = Math.max(1, Math.round((beatEnd - beatStart) * fps));
  if (visual.type === 'journey') return <JourneyScene visual={visual} frame={localFrame} fps={fps} duration={duration}/>;
  if (visual.type === 'household') return <HouseholdScene visual={visual} frame={localFrame} fps={fps}/>;
  return <CharacterScene visual={visual} frame={localFrame} fps={fps}/>;
};
