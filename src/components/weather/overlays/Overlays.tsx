/**
 * Holiday Overlays — SVG overlays for seasonal/holiday events.
 * Christmas, Halloween, Valentine's, 4th of July, New Year's,
 * Cinco de Mayo, Thanksgiving, St. Patrick's, Día de los Muertos,
 * Mexican Independence, Virgin of Guadalupe.
 * Extracted from WeatherWidget.tsx for modularity.
 */
"use client";

function ChristmasOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Fairy lights string */}
      <path d="M0 8 Q40 3 80 10 Q120 17 160 8 Q200 -1 240 8 Q280 17 320 8" stroke="rgba(120,80,40,0.5)" strokeWidth="1.5" fill="none"/>
      {/* Light bulbs */}
      {[15, 55, 95, 135, 175, 215, 255, 295].map((x, i) => {
        const y = 8 + Math.sin((x / 320) * Math.PI * 2) * 5;
        const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#f97316", "#a855f7", "#ec4899", "#06b6d4"];
        return (
          <g key={i}>
            <circle cx={x} cy={y + 4} r="5" fill={colors[i % colors.length]} opacity="0.85"
              style={{ animation: `weatherGlowPulse ${1.5 + i * 0.3}s ease-in-out ${i * 0.2}s infinite`, filter: `drop-shadow(0 0 4px ${colors[i % colors.length]})` }} />
          </g>
        );
      })}
      {/* Snow on edges */}
      {[0, 40, 80, 120, 160, 200, 240, 280, 320].map((x, i) => (
        <ellipse key={i} cx={x} cy={200} rx="25" ry="10" fill="rgba(219,234,254,0.20)" />
      ))}
      {/* Cozy warm glow */}
      <circle cx="160" cy="220" r="120" fill="rgba(251,146,60,0.04)" />
    </svg>
  );
}

function HalloweenOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Moon */}
      <circle cx="270" cy="35" r="28" fill="rgba(253,224,71,0.12)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }}>
        <animate attributeName="r" values="28;31;28" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="270" cy="35" r="20" fill="rgba(253,224,71,0.20)" />
      {/* Silhouetted bats */}
      {[
        { x: 80, y: 40, s: 1.0, delay: "0s" },
        { x: 180, y: 20, s: 0.7, delay: "0.8s" },
        { x: 130, y: 60, s: 0.85, delay: "0.4s" },
      ].map((bat, i) => (
        <g key={i} style={{ animation: `weatherCloudBob ${3 + i}s ease-in-out ${bat.delay} infinite` }}
          transform={`translate(${bat.x},${bat.y}) scale(${bat.s})`}>
          <path d="M0 0 Q-12 -8 -18 -2 Q-12 2 0 0" fill="rgba(30,0,60,0.8)" />
          <path d="M0 0 Q12 -8 18 -2 Q12 2 0 0" fill="rgba(30,0,60,0.8)" />
          <ellipse cx="0" cy="1" rx="3" ry="4" fill="rgba(30,0,60,0.9)" />
        </g>
      ))}
      {/* Ground fog / mist */}
      {[0, 1, 2].map(i => (
        <ellipse key={i} cx={60 + i * 100} cy="195" rx={90 + i * 10} ry="20"
          fill={`rgba(120,0,180,0.0${5 + i})`}
          style={{ animation: `weatherCloudBob ${4 + i}s ease-in-out ${i * 1.5}s infinite` }} />
      ))}
      {/* Eerie glow at bottom */}
      <ellipse cx="160" cy="210" rx="150" ry="40" fill="rgba(249,115,22,0.05)" />
    </svg>
  );
}

function FireworksOverlay() {
  const bursts = [
    { cx: 80, cy: 50, color: "#ef4444", delay: "0s" },
    { cx: 200, cy: 35, color: "#3b82f6", delay: "0.6s" },
    { cx: 280, cy: 65, color: "#f8fafc", delay: "1.2s" },
    { cx: 140, cy: 80, color: "#ef4444", delay: "1.8s" },
  ];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {bursts.map((b, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse 2.4s ease-in-out ${b.delay} infinite` }}>
          {Array.from({ length: 12 }, (_, j) => {
            const angle = (j / 12) * Math.PI * 2;
            const r = 22;
            return (
              <line key={j}
                x1={b.cx} y1={b.cy}
                x2={b.cx + Math.cos(angle) * r} y2={b.cy + Math.sin(angle) * r}
                stroke={b.color} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
            );
          })}
          <circle cx={b.cx} cy={b.cy} r="4" fill={b.color} opacity="0.9" />
        </g>
      ))}
      {/* Red white blue glow bands */}
      <rect x="0" y="170" width="320" height="4" fill="rgba(239,68,68,0.20)" rx="2" />
      <rect x="0" y="180" width="320" height="4" fill="rgba(248,250,252,0.15)" rx="2" />
      <rect x="0" y="190" width="320" height="4" fill="rgba(59,130,246,0.20)" rx="2" />
    </svg>
  );
}

function ValentinesOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Large glowing heart in background */}
      <path d="M160 160 C160 160 110 125 105 100 C100 75 120 65 135 80 C142 87 155 98 160 110 C165 98 178 87 185 80 C200 65 220 75 215 100 C210 125 160 160 160 160 Z"
        fill="rgba(244,63,94,0.08)" style={{ animation: "weatherGlowPulse 3s ease-in-out infinite" }} />
      {/* Small floating hearts */}
      {[
        { x: 40, y: 30 }, { x: 270, y: 55 }, { x: 100, y: 75 }, { x: 230, y: 25 },
      ].map((h, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${2 + i * 0.5}s ease-in-out ${i * 0.4}s infinite` }}>
          <path d={`M${h.x} ${h.y + 4} C${h.x} ${h.y + 4} ${h.x - 6} ${h.y} ${h.x - 6} ${h.y - 3} C${h.x - 6} ${h.y - 6} ${h.x - 3} ${h.y - 8} ${h.x} ${h.y - 5} C${h.x + 3} ${h.y - 8} ${h.x + 6} ${h.y - 6} ${h.x + 6} ${h.y - 3} C${h.x + 6} ${h.y} ${h.x} ${h.y + 4} ${h.x} ${h.y + 4}`}
            fill="rgba(244,63,94,0.35)" />
        </g>
      ))}
      {/* Rose glow at corners */}
      <circle cx="0" cy="200" r="80" fill="rgba(244,63,94,0.06)" />
      <circle cx="320" cy="0" r="60" fill="rgba(244,63,94,0.06)" />
    </svg>
  );
}

function NewYearsOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Gold shimmer aura */}
      <circle cx="160" cy="100" r="140" fill="rgba(234,179,8,0.04)" style={{ animation: "weatherGlowPulse 2.5s ease-in-out infinite" }} />
      {/* Gold star bursts */}
      {[{ cx: 50, cy: 40 }, { cx: 270, cy: 30 }, { cx: 160, cy: 20 }, { cx: 100, cy: 80 }, { cx: 230, cy: 70 }].map((s, i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${1.5 + i * 0.4}s ease-in-out ${i * 0.3}s infinite` }}>
          {Array.from({ length: 8 }, (_, j) => {
            const a = (j / 8) * Math.PI * 2;
            return (
              <line key={j} x1={s.cx} y1={s.cy}
                x2={s.cx + Math.cos(a) * 12} y2={s.cy + Math.sin(a) * 12}
                stroke="rgba(234,179,8,0.6)" strokeWidth="1.5" strokeLinecap="round" />
            );
          })}
          <circle cx={s.cx} cy={s.cy} r="3" fill="rgba(234,179,8,0.9)" />
        </g>
      ))}
      {/* Champagne fizz at bottom */}
      <path d="M0 185 Q80 178 160 185 Q240 192 320 185 L320 200 L0 200 Z" fill="rgba(234,179,8,0.08)" />
    </svg>
  );
}

function CincoDeMayoOverlay() {
  // Papel picado banner string + colorful triangle cut-outs
  const bannerColors = ["#ef4444","#f59e0b","#22c55e","#3b82f6","#a855f7","#ec4899","#ffffff"];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Fiesta string 1 — main banner */}
      <path d="M0 6 Q40 2 80 8 Q120 14 160 6 Q200 -2 240 6 Q280 14 320 6" stroke="rgba(80,40,0,0.6)" strokeWidth="1.5" fill="none"/>
      {/* Papel picado flags */}
      {bannerColors.map((color, i) => {
        const x = 15 + i * 42;
        const ys = 6 + Math.sin((x/320)*Math.PI*2)*4;
        return (
          <g key={i} style={{ animation: `weatherCloudBob ${2+i*0.3}s ease-in-out ${i*0.2}s infinite` }}>
            <polygon points={`${x-10} ${ys+2},${x+10} ${ys+2},${x} ${ys+22}`} fill={color} opacity="0.88"/>
            {/* Cut-out diamond */}
            <polygon points={`${x-5} ${ys+10},${x} ${ys+6},${x+5} ${ys+10},${x} ${ys+14}`} fill="rgba(0,0,0,0.25)"/>
            {/* Glow */}
            <circle cx={x} cy={ys+12} r="8" fill={color} opacity="0.10" style={{ filter: `drop-shadow(0 0 6px ${color})` }}/>
          </g>
        );
      })}

      {/* Fiesta string 2 — lower */}
      <path d="M0 30 Q50 26 100 32 Q150 38 200 30 Q260 22 320 30" stroke="rgba(80,40,0,0.4)" strokeWidth="1" fill="none"/>
      {["#fbbf24","#ef4444","#22c55e","#60a5fa","#d946ef"].map((color, i) => {
        const x = 30 + i * 60;
        const ys = 30 + Math.sin((x/320)*Math.PI*2)*3;
        return (
          <g key={i} style={{ animation: `weatherCloudBob ${2.5+i*0.25}s ease-in-out ${i*0.35}s infinite` }}>
            <polygon points={`${x-8} ${ys+2},${x+8} ${ys+2},${x} ${ys+18}`} fill={color} opacity="0.82"/>
            <polygon points={`${x-4} ${ys+9},${x} ${ys+5},${x+4} ${ys+9},${x} ${ys+13}`} fill="rgba(0,0,0,0.2)"/>
          </g>
        );
      })}

      {/* Warm golden glow at bottom */}
      <ellipse cx="160" cy="210" rx="180" ry="45" fill="rgba(245,158,11,0.08)"/>
      {/* Mexico flag color bands at base */}
      <rect x="0" y="188" width="107" height="4" fill="rgba(34,197,94,0.25)" rx="2"/>
      <rect x="107" y="188" width="106" height="4" fill="rgba(255,255,255,0.20)" rx="2"/>
      <rect x="213" y="188" width="107" height="4" fill="rgba(220,38,38,0.25)" rx="2"/>
      {/* Starburst lantern decorations */}
      {[[50,50],[270,45],[160,35]].map(([cx,cy],i) => (
        <g key={i} style={{ animation: `weatherGlowPulse ${2+i*0.6}s ease-in-out ${i*0.4}s infinite` }}>
          {Array.from({length:8},(_,j) => {
            const a=(j/8)*Math.PI*2;
            return <line key={j} x1={cx} y1={cy} x2={cx+Math.cos(a)*12} y2={cy+Math.sin(a)*12}
              stroke={bannerColors[(i+j)%bannerColors.length]} strokeWidth="1.5" strokeLinecap="round" opacity="0.7"/>;
          })}
          <circle cx={cx} cy={cy} r="5" fill={bannerColors[i*2%bannerColors.length]} opacity="0.8"/>
        </g>
      ))}
    </svg>
  );
}

function ThanksgivingOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Harvest moon backdrop */}
      <circle cx="260" cy="38" r="50" fill="rgba(217,119,6,0.08)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
      <circle cx="260" cy="38" r="32" fill="rgba(245,158,11,0.15)"/>
      <circle cx="260" cy="38" r="22" fill="rgba(251,191,36,0.35)"/>

      {/* Cornucopia horn silhouette — right side */}
      <g opacity="0.28">
        <path d="M180 120 Q220 100 265 90 Q295 85 310 95 Q295 105 280 110 Q260 115 240 120 Q210 128 180 145 Z"
          fill="rgba(146,64,14,0.7)" />
        <path d="M180 120 Q170 130 175 140 Q178 143 180 145 Z" fill="rgba(120,53,15,0.8)"/>
        {/* Horn spiral */}
        <path d="M195 130 Q205 120 215 122 Q210 127 200 128 Q195 130 195 130" stroke="rgba(253,186,116,0.5)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
      </g>

      {/* Autumn leaf crown — scattered leaves */}
      {[
        {x:15,y:22,r:0,color:"rgba(239,68,68,0.50)",size:14},
        {x:40,y:15,r:20,color:"rgba(249,115,22,0.55)",size:12},
        {x:70,y:18,r:-15,color:"rgba(202,138,4,0.50)",size:16},
        {x:100,y:12,r:10,color:"rgba(234,88,12,0.50)",size:13},
        {x:130,y:20,r:-10,color:"rgba(245,158,11,0.55)",size:11},
        {x:25,y:32,r:30,color:"rgba(220,38,38,0.45)",size:10},
        {x:55,y:28,r:-20,color:"rgba(251,191,36,0.45)",size:14},
        {x:85,y:30,r:15,color:"rgba(239,68,68,0.40)",size:12},
      ].map(({x,y,r,color,size},i) => (
        <g key={i} transform={`translate(${x},${y}) rotate(${r})`}
          style={{ animation: `weatherHarvestFloat ${3+i*0.4}s ease-in-out ${i*0.3}s infinite` }}>
          {/* Leaf shape */}
          <path d={`M0 0 Q${size*0.5} ${-size*0.7} ${size} 0 Q${size*0.5} ${size*0.7} 0 0`} fill={color}/>
          <line x1="0" y1="0" x2={size} y2="0" stroke="rgba(255,255,255,0.3)" strokeWidth="0.8"/>
        </g>
      ))}

      {/* Ground fog + warm harvest glow */}
      {[0,1,2].map(i => (
        <ellipse key={i} cx={80+i*80} cy={195+i*4} rx={75+i*12} ry={18+i*3}
          fill={`rgba(217,119,6,0.0${5+i*2})`}
          style={{ animation: `weatherCloudBob ${5+i*1.5}s ease-in-out ${i}s infinite` }}/>
      ))}
      <ellipse cx="160" cy="210" rx="190" ry="40" fill="rgba(180,83,9,0.07)"/>
    </svg>
  );
}

function StPatricksOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Rainbow arc */}
      <g opacity="0.20">
        <path d="M-10 200 Q80 50 160 40 Q240 50 330 200" stroke="rgba(239,68,68,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 62 160 52 Q240 62 330 200" stroke="rgba(249,115,22,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 74 160 64 Q240 74 330 200" stroke="rgba(234,179,8,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 86 160 76 Q240 86 330 200" stroke="rgba(34,197,94,0.9)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 98 160 88 Q240 98 330 200" stroke="rgba(59,130,246,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
        <path d="M-10 200 Q80 110 160 100 Q240 110 330 200" stroke="rgba(139,92,246,0.8)" strokeWidth="5" fill="none" strokeLinecap="round"/>
      </g>

      {/* Pot of gold — bottom right */}
      <g transform="translate(250,155)" opacity="0.40">
        <ellipse cx="0" cy="-5" rx="25" ry="8" fill="rgba(234,179,8,0.8)"/>
        <path d="M-22 0 Q-24 25 0 28 Q24 25 22 0 Z" fill="rgba(120,53,15,0.7)"/>
        <path d="M-20 2 Q-22 22 0 25 Q22 22 20 2 Z" fill="rgba(146,64,14,0.8)"/>
        {/* Gold coins peeking */}
        {[-10,0,10].map((x,i) => (
          <ellipse key={i} cx={x} cy={-3+i*2} rx="6" ry="4" fill="rgba(251,191,36,0.9)" style={{ animation: `weatherGlowPulse ${1.5+i*0.3}s ease-in-out ${i*0.2}s infinite` }}/>
        ))}
      </g>

      {/* Clover field at base */}
      {[15,40,65,90,115,140,165,190,215,240,265,290].map((x,i) => (
        <g key={i} transform={`translate(${x},${182+(i%3)*5})`} opacity={0.35+i%3*0.08}
          style={{ animation: `weatherCloudBob ${3+i*0.2}s ease-in-out ${i*0.15}s infinite` }}>
          {/* 3-leaf clover */}
          <circle cx="0" cy="-6" r="4.5" fill="rgba(34,197,94,0.8)"/>
          <circle cx="-5" cy="0" r="4.5" fill="rgba(22,163,74,0.8)"/>
          <circle cx="5" cy="0" r="4.5" fill="rgba(21,128,61,0.8)"/>
          {i%4===0 && <circle cx="0" cy="6" r="4.5" fill="rgba(34,197,94,0.75)"/>}
          <line x1="0" y1="0" x2="0" y2="10" stroke="rgba(21,128,61,0.7)" strokeWidth="1.5" strokeLinecap="round"/>
        </g>
      ))}

      {/* Emerald green glow */}
      <ellipse cx="160" cy="210" rx="200" ry="45" fill="rgba(34,197,94,0.07)"/>
      <circle cx="160" cy="100" r="120" fill="rgba(34,197,94,0.03)" style={{ animation: "weatherSunHalo 6s ease-in-out infinite" }}/>
    </svg>
  );
}

function DiaDeLosMuertosOverlay() {
  const flags = [
    { color: "#d946ef", label: "💀" },
    { color: "#ea580c", label: "🌼" },
    { color: "#8b5cf6", label: "💀" },
    { color: "#ec4899", label: "🌼" },
    { color: "#fbbf24", label: "💀" },
    { color: "#a855f7", label: "🌼" },
    { color: "#f97316", label: "💀" }
  ];
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Papel Picado string */}
      <path d="M-10 10 Q40 2 80 12 Q120 22 160 12 Q200 2 240 12 Q280 22 330 10" stroke="rgba(255,255,255,0.25)" strokeWidth="1" fill="none"/>
      
      {/* Hanging papel picado flags */}
      {flags.map((f, i) => {
        const x = 20 + i * 40;
        const y = 10 + Math.sin((x / 320) * Math.PI * 2) * 5;
        return (
          <g key={i} transform={`translate(${x}, ${y})`} style={{ animation: `weatherCloudBob ${2.5 + i * 0.3}s ease-in-out ${i * 0.1}s infinite` }}>
            <path d="M-15 0 L15 0 L15 22 L5 22 L0 16 L-5 22 L-15 22 Z" fill={f.color} opacity="0.82" />
            {/* Traditional cut-out detail */}
            <circle cx="0" cy="8" r="4.5" fill="rgba(0,0,0,0.3)" />
            <text x="0" y="11" fontSize="8" textAnchor="middle" fill="rgba(255,255,255,0.85)" style={{ userSelect: "none" }}>{f.label}</text>
            {/* Tiny glow */}
            <circle cx="0" cy="8" r="10" fill={f.color} opacity="0.08" style={{ filter: `drop-shadow(0 0 4px ${f.color})` }} />
          </g>
        );
      })}

      {/* Ofrenda Altar Arch - Silhouette in gold/marigold */}
      <g opacity="0.25">
        {/* Arch */}
        <path d="M40 200 Q40 100 160 100 Q280 100 280 200" stroke="#f59e0b" strokeWidth="8" fill="none" strokeLinecap="round"/>
        {/* Flower circles along the arch */}
        {[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const cx = 160 + Math.cos(rad) * 120;
          const cy = 200 - Math.sin(rad) * 100;
          return <circle key={i} cx={cx} cy={cy} r="4.5" fill="#f97316" />;
        })}
      </g>

      {/* Altar steps at base */}
      <path d="M20 200 L300 200 L280 188 L40 188 Z" fill="rgba(88,12,47,0.4)" opacity="0.7"/>
      <path d="M50 188 L270 188 L255 178 L65 178 Z" fill="rgba(58,0,63,0.5)" opacity="0.8"/>

      {/* Altar decorations: candles + cempasúchil flower heads */}
      {[[75, 184], [105, 174], [135, 174], [160, 172], [185, 174], [215, 174], [245, 184]].map(([cx, cy], i) => (
        <g key={i} transform={`translate(${cx}, ${cy})`}>
          {/* Candle body */}
          <rect x="-2" y="2" width="4" height="12" fill="#fff" rx="1"/>
          {/* Flame with pulse animation */}
          <path d="M-1.5 2 Q0 -6 1.5 2 Z" fill="#f59e0b" style={{ animation: `weatherGlowPulse ${1 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}/>
          <circle cx="0" cy="-2" r="5" fill="#f97316" opacity="0.3" style={{ animation: `weatherGlowPulse ${1 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}/>
        </g>
      ))}

      {/* Marigold flowers piled at base */}
      {[25, 45, 60, 90, 120, 150, 170, 200, 230, 260, 280, 295].map((x, i) => (
        <g key={i} transform={`translate(${x}, ${192 + (i % 3) * 3})`} opacity="0.75" style={{ animation: `weatherCloudBob ${3.5 + i * 0.15}s ease-in-out ${i * 0.2}s infinite` }}>
          <circle cx="0" cy="0" r="5.5" fill="#f97316"/>
          <circle cx="0" cy="0" r="3.5" fill="#fbbf24"/>
          <circle cx="0" cy="0" r="1.5" fill="#ef4444"/>
        </g>
      ))}

      {/* Warm golden light projection */}
      <ellipse cx="160" cy="195" rx="150" ry="35" fill="rgba(245,158,11,0.06)" />
      <circle cx="160" cy="150" r="80" fill="rgba(236,72,153,0.02)" style={{ animation: "weatherSunHalo 8s ease-in-out infinite" }} />
    </svg>
  );
}

function MexicanIndependenceOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Independence Bell (Campana de Dolores) at top center */}
      <g transform="translate(160, 32)" opacity="0.75">
        {/* Support beam */}
        <rect x="-24" y="-12" width="48" height="4" fill="rgba(120,53,15,0.8)" rx="1"/>
        <rect x="-18" y="-8" width="36" height="2" fill="rgba(78,53,15,0.9)" />
        {/* Hanger */}
        <path d="M-4 -8 L-4 -2 L4 -2 L4 -8 Z" fill="rgba(156,163,175,0.9)" />
        {/* Bell curve */}
        <path d="M-12 12 Q-14 -2 0 -2 Q14 -2 12 12 Q16 16 16 19 L-16 19 Q-16 16 -12 12 Z" fill="rgba(217,119,6,0.9)" />
        <path d="M-10 12 Q-12 0 0 0 Q12 0 10 12 Q13 14 13 17 L-13 17 Q-13 14 -10 12 Z" fill="rgba(251,191,36,0.95)" />
        {/* Clapper (bell tongue) */}
        <circle cx="0" cy="22" r="3" fill="rgba(120,53,15,0.9)" style={{ animation: "weatherCloudBob 1.5s ease-in-out infinite", transformOrigin: "0px 10px" }}/>
        {/* Sound waves glowing */}
        <circle cx="0" cy="14" r="28" fill="rgba(251,191,36,0.05)" style={{ animation: "weatherSunHalo 3s ease-in-out infinite" }}/>
      </g>

      {/* Elegant tricolor flag-drape banners at top corners */}
      <g opacity="0.35">
        {/* Left corner banner */}
        <path d="M0 0 L60 0 C45 20 25 35 0 40 Z" fill="rgba(22,163,74,0.7)" />
        <path d="M0 0 L45 0 C32 15 18 25 0 30 Z" fill="rgba(255,255,255,0.6)" />
        <path d="M0 0 L30 0 C20 10 10 18 0 20 Z" fill="rgba(220,38,38,0.7)" />
        
        {/* Right corner banner */}
        <path d="M320 0 L260 0 C275 20 295 35 320 40 Z" fill="rgba(220,38,38,0.7)" />
        <path d="M320 0 L275 0 C288 15 302 25 320 30 Z" fill="rgba(255,255,255,0.6)" />
        <path d="M320 0 L290 0 C300 10 310 18 320 20 Z" fill="rgba(22,163,74,0.7)" />
      </g>

      {/* Angel of Independence Silhouette — Bottom center rising elegantly */}
      <g transform="translate(160, 200)" opacity="0.22">
        {/* Column pedestal */}
        <rect x="-8" y="-45" width="16" height="45" fill="rgba(255,255,255,0.6)" rx="1"/>
        <path d="-14 -45 L14 -45 L8 -55 L-8 -55 Z" fill="rgba(255,255,255,0.5)"/>
        <rect x="-16" y="-3" width="32" height="3" fill="rgba(255,255,255,0.7)" rx="1"/>
        
        {/* Winged Angel Statue Silhouette */}
        <g transform="translate(0, -66)">
          {/* Body */}
          <ellipse cx="0" cy="3" rx="3.5" ry="7" fill="rgba(251,191,36,0.8)"/>
          <circle cx="0" cy="-6" r="2.8" fill="rgba(251,191,36,0.8)"/>
          {/* Wings */}
          <path d="M0 0 Q-15 -18 -18 -8 Q-12 -2 0 4 Z" fill="rgba(251,191,36,0.7)"/>
          <path d="M0 0 Q15 -18 18 -8 Q12 -2 0 4 Z" fill="rgba(251,191,36,0.7)"/>
          {/* Raised arms with wreath */}
          <path d="M0 -3 Q-6 -10 -9 -8" stroke="rgba(251,191,36,0.8)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
          <path d="M0 -3 Q6 -10 9 -8" stroke="rgba(251,191,36,0.8)" strokeWidth="1.8" fill="none" strokeLinecap="round"/>
          <circle cx="-10" cy="-9" r="2" fill="none" stroke="rgba(34,197,94,0.8)" strokeWidth="1"/>
        </g>
      </g>

      {/* Tricolor flag base line highlight */}
      <rect x="0" y="194" width="107" height="6" fill="rgba(34,197,94,0.3)" rx="2"/>
      <rect x="107" y="194" width="106" height="6" fill="rgba(255,255,255,0.22)" rx="2"/>
      <rect x="213" y="194" width="107" height="6" fill="rgba(220,38,38,0.3)" rx="2"/>

      {/* Festive sparkles glow */}
      <circle cx="160" cy="35" r="50" fill="rgba(34,197,94,0.04)" style={{ animation: "weatherSunHalo 4s ease-in-out infinite" }}/>
      <circle cx="160" cy="130" r="90" fill="rgba(220,38,38,0.03)" style={{ animation: "weatherSunHalo 6s ease-in-out 1s infinite" }}/>
    </svg>
  );
}

function VirginGuadalupeOverlay() {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style={{ pointerEvents: "none" }}>
      {/* Holy Ray Sunburst (Resplandor) in center background */}
      <g transform="translate(160, 95)" opacity="0.18">
        <circle cx="0" cy="0" r="50" fill="rgba(253,224,71,0.25)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
        {Array.from({ length: 16 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          const isLong = i % 2 === 0;
          const r1 = 15;
          const r2 = isLong ? 68 : 45;
          return (
            <line key={i} x1={Math.cos(a) * r1} y1={Math.sin(a) * r1} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2}
              stroke="rgba(253,224,71,0.7)" strokeWidth={isLong ? 2.5 : 1.5} strokeLinecap="round"
              style={{ animation: `weatherRayPulse ${2.8 + (i % 3) * 0.4}s ease-in-out ${(i * 0.15).toFixed(2)}s infinite` }} />
          );
        })}
      </g>

      {/* Starry Constellation Backdrop (Mantle design stars) */}
      <g opacity="0.30">
        {[
          [80, 50], [95, 38], [115, 42], [105, 65],
          [240, 50], [225, 38], [205, 42], [215, 65],
          [60, 90], [75, 110], [100, 100], [90, 125],
          [260, 90], [245, 110], [220, 100], [230, 125],
          [130, 70], [190, 70], [125, 120], [195, 120]
        ].map(([cx, cy], i) => (
          <g key={i} transform={`translate(${cx}, ${cy})`} style={{ animation: `weatherGlowPulse ${2 + i * 0.25}s ease-in-out ${i * 0.1}s infinite` }}>
            {/* 8-pointed gold stars */}
            <path d="M-3 0 L3 0 M0 -3 L0 3 M-2 -2 L2 2 M-2 2 L2 -2" stroke="#fde047" strokeWidth="1" />
            <circle cx="0" cy="0" r="1" fill="#fff" />
          </g>
        ))}
      </g>

      {/* Castile roses blooming at base */}
      {[
        { x: 35, y: 188, size: 8, color: "#ef4444" },
        { x: 65, y: 184, size: 9, color: "#ec4899" },
        { x: 95, y: 188, size: 7.5, color: "#ef4444" },
        { x: 130, y: 182, size: 10, color: "#f43f5e" },
        { x: 160, y: 185, size: 11, color: "#ef4444" },
        { x: 190, y: 182, size: 10, color: "#f43f5e" },
        { x: 225, y: 188, size: 7.5, color: "#ef4444" },
        { x: 255, y: 184, size: 9, color: "#ec4899" },
        { x: 285, y: 188, size: 8, color: "#ef4444" },
        // Front layer
        { x: 50, y: 192, size: 7, color: "#ec4899" },
        { x: 110, y: 191, size: 8.5, color: "#f43f5e" },
        { x: 145, y: 190, size: 9.5, color: "#ef4444" },
        { x: 175, y: 190, size: 9.5, color: "#ef4444" },
        { x: 210, y: 191, size: 8.5, color: "#f43f5e" },
        { x: 270, y: 192, size: 7, color: "#ec4899" }
      ].map((rose, i) => (
        <g key={i} transform={`translate(${rose.x}, ${rose.y})`} opacity="0.8" style={{ animation: `weatherCloudBob ${3 + i * 0.2}s ease-in-out ${i * 0.15}s infinite` }}>
          {/* Castile Rose Vector */}
          <circle cx="0" cy="0" r={rose.size} fill={rose.color}/>
          <circle cx="-3" cy="-1" r={rose.size * 0.7} fill="#f43f5e" opacity="0.9"/>
          <circle cx="3" cy="-1" r={rose.size * 0.7} fill="#ec4899" opacity="0.9"/>
          <circle cx="0" cy="3" r={rose.size * 0.7} fill="#ef4444" opacity="0.9"/>
          <circle cx="0" cy="0" r={rose.size * 0.35} fill="#fb7185"/>
          {/* Leaves */}
          <path d={`M${-rose.size} 2 Q${-rose.size - 4} 6 ${-rose.size} 8 Q${-rose.size + 4} 6 ${-rose.size} 2`} fill="rgba(13,148,136,0.6)" />
          <path d={`M${rose.size} 2 Q${rose.size + 4} 6 ${rose.size} 8 Q${rose.size - 4} 6 ${rose.size} 2`} fill="rgba(13,148,136,0.6)" />
        </g>
      ))}

      {/* Subtle crescent moon silhouette at bottom center */}
      <g transform="translate(160, 168)" opacity="0.22">
        <circle cx="0" cy="0" r="14" fill="rgba(255,255,255,0.06)" style={{ animation: "weatherGlowPulse 4s ease-in-out infinite" }} />
        <path d="M-10 -4 A10 10 0 1 0 10 4 A12 12 0 0 1 -10 -4 Z" fill="rgba(156,163,175,0.95)" />
      </g>

      {/* Heavenly turquoise and gold base glow */}
      <ellipse cx="160" cy="205" rx="160" ry="32" fill="rgba(45,212,191,0.08)"/>
      <ellipse cx="160" cy="210" rx="100" ry="20" fill="rgba(253,224,71,0.05)"/>
    </svg>
  );
}

// ─── Particle System ─────────────────────────────────────────────────────────

// Holiday overlay map for dynamic rendering
export const HOLIDAY_OVERLAYS: Record<string, React.ComponentType> = {
  christmas: ChristmasOverlay,
  halloween: HalloweenOverlay,
  july4th: FireworksOverlay,
  valentines: ValentinesOverlay,
  newyears: NewYearsOverlay,
  cincodemayo: CincoDeMayoOverlay,
  thanksgiving: ThanksgivingOverlay,
  stpatricks: StPatricksOverlay,
  diadelosmuertos: DiaDeLosMuertosOverlay,
  mexicanindependence: MexicanIndependenceOverlay,
  virginguadalupe: VirginGuadalupeOverlay,
};

export {
  ChristmasOverlay, HalloweenOverlay, FireworksOverlay, ValentinesOverlay,
  NewYearsOverlay, CincoDeMayoOverlay, ThanksgivingOverlay, StPatricksOverlay,
  DiaDeLosMuertosOverlay, MexicanIndependenceOverlay, VirginGuadalupeOverlay,
};
