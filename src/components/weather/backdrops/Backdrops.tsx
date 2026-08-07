/**
 * Season Backdrops — Full SVG background art for each season.
 * Spring, Summer, Autumn, Winter — each with day/night variants.
 * Extracted from WeatherWidget.tsx for modularity.
 */
"use client";

import type { TimeOfDayFlag } from "../helpers";

function SpringBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  const branchColor = tod === "night" ? "#f9a8d4" : "#be185d";
  const blossomFill = tod === "night" ? "#fbcfe8" : "#fce7f3";
  const blossomCenter = tod === "night" ? "#f472b6" : "#ec4899";
  const grassColor = tod === "night" ? "#4ade80" : "#16a34a";

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* Sky gradient overlay */}
      <defs>
        <linearGradient id="springSkyday" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tod === "night" ? "#1a0d2e" : "#fce7f3"} stopOpacity="0.4" />
          <stop offset="100%" stopColor="transparent" />
        </linearGradient>
      </defs>
      <rect width="320" height="120" fill="url(#springSkyday)" />

      {/* Left branch cluster */}
      <g opacity="0.30">
        <line x1="0" y1="100" x2="35" y2="55" stroke={branchColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="35" y1="55" x2="15" y2="20" stroke={branchColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="35" y1="55" x2="65" y2="30" stroke={branchColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="15" y1="20" x2="5" y2="0" stroke={branchColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="15" y1="20" x2="30" y2="5" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="65" y1="30" x2="80" y2="10" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="65" y1="30" x2="50" y2="10" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Left blossoms */}
        {[[5,0],[18,6],[32,5],[50,10],[65,10],[80,10],[10,20],[25,15],[38,22],[60,30],[70,28]].map(([cx,cy],i) => (
          <g key={i} transform={`translate(${cx},${cy})`} style={{ animation: `weatherGlowPulse ${1.8+i*0.25}s ease-in-out ${i*0.18}s infinite` }}>
            {[0,72,144,216,288].map((angle,j) => (
              <ellipse key={j} cx={Math.cos(angle*Math.PI/180)*4} cy={Math.sin(angle*Math.PI/180)*4} rx="3.8" ry="2.6" transform={`rotate(${angle})`} fill={blossomFill} opacity="0.95"/>
            ))}
            <circle cx="0" cy="0" r="1.6" fill={blossomCenter}/>
          </g>
        ))}
      </g>

      {/* Right branch cluster */}
      <g opacity="0.28">
        <line x1="320" y1="80" x2="285" y2="40" stroke={branchColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="285" y1="40" x2="260" y2="10" stroke={branchColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="285" y1="40" x2="310" y2="15" stroke={branchColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="260" y1="10" x2="245" y2="0" stroke={branchColor} strokeWidth="2" strokeLinecap="round"/>
        {[[260,10],[250,2],[270,5],[295,15],[308,15],[285,40],[272,32],[295,32]].map(([cx,cy],i) => (
          <g key={i} transform={`translate(${cx},${cy})`} style={{ animation: `weatherGlowPulse ${2+i*0.2}s ease-in-out ${i*0.15}s infinite` }}>
            {[0,72,144,216,288].map((angle,j) => (
              <ellipse key={j} cx={Math.cos(angle*Math.PI/180)*3.5} cy={Math.sin(angle*Math.PI/180)*3.5} rx="3.2" ry="2.2" transform={`rotate(${angle})`} fill={blossomFill} opacity="0.9"/>
            ))}
            <circle cx="0" cy="0" r="1.4" fill={blossomCenter}/>
          </g>
        ))}
      </g>

      {/* Rolling meadow hills */}
      <g opacity={tod === "night" ? 0.18 : 0.28}>
        <ellipse cx="60" cy="195" rx="120" ry="30" fill={grassColor} />
        <ellipse cx="260" cy="198" rx="100" ry="25" fill={grassColor} />
      </g>

      {/* Swaying tall grass blades */}
      <g opacity={tod === "night" ? 0.15 : 0.22}>
        {[8,22,38,54,70,86,102,118,134,150,166,182,198,214,230,246,262,278,294,310].map((x,i) => (
          <path key={i} d={`M${x} 200 Q${x+(i%2===0?-6:6)} ${178+(i%3)*4} ${x+(i%2===0?3:-3)} ${160+(i%4)*6}`}
            stroke={grassColor} strokeWidth="1.8" fill="none" strokeLinecap="round"
            style={{ animation: `weatherCloudBob ${2.5+i*0.1}s ease-in-out ${i*0.08}s infinite` }} />
        ))}
      </g>

      {/* Night: moon glow + firefly bokeh */}
      {tod === "night" && (
        <g>
          <circle cx="60" cy="35" r="28" fill="rgba(249,168,212,0.08)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <circle cx="60" cy="35" r="18" fill="rgba(249,168,212,0.15)"/>
          <path d="M58 22 A14 14 0 1 0 72 36 A18 18 0 0 1 58 22 Z" fill="rgba(253,164,175,0.7)"/>
          {/* Bokeh dots */}
          {[[40,90],[80,70],[140,110],[200,80],[250,95],[170,60],[110,85],[280,75]].map(([x,y],i) => (
            <circle key={i} cx={x} cy={y} r={1.5+i%2} fill="rgba(249,168,212,0.5)"
              style={{ animation: `weatherGlowPulse ${1.5+i*0.3}s ease-in-out ${i*0.2}s infinite` }}/>
          ))}
        </g>
      )}

      {/* Day: sun rays peaking from top-left */}
      {tod === "day" && (
        <g opacity="0.18">
          <circle cx="30" cy="25" r="45" fill="rgba(251,207,232,0.3)" style={{ animation: "weatherSunHalo 4s ease-in-out infinite" }}/>
          {[0,30,60,90,120,150,180].map((a,i) => {
            const rad = a * Math.PI / 180;
            return <line key={i} x1={30+Math.cos(rad)*22} y1={25+Math.sin(rad)*22} x2={30+Math.cos(rad)*38} y2={25+Math.sin(rad)*38}
              stroke="#fce7f3" strokeWidth="2" strokeLinecap="round"
              style={{ animation: `weatherRayPulse 2.5s ease-in-out ${i*0.3}s infinite` }}/>;
          })}
          <circle cx="30" cy="25" r="18" fill="rgba(252,231,243,0.5)"/>
        </g>
      )}

      {/* Ground mist */}
      <ellipse cx="160" cy="202" rx="200" ry="35" fill={tod === "night" ? "rgba(217,70,239,0.07)" : "rgba(249,168,212,0.18)"} />
    </svg>
  );
}

function SummerBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="summerSunGlow" cx="85%" cy="15%" r="50%">
          <stop offset="0%" stopColor="rgba(251,191,36,0.18)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <radialGradient id="summerMoonGlow" cx="15%" cy="15%" r="40%">
          <stop offset="0%" stopColor="rgba(167,139,250,0.12)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {tod === "night" ? (
        /* Night: rich galaxy scene */
        <g>
          <rect width="320" height="200" fill="url(#summerMoonGlow)" />
          {/* Milky way arch */}
          <ellipse cx="160" cy="80" rx="210" ry="55" fill="none" stroke="rgba(167,139,250,0.08)" strokeWidth="32" />
          <ellipse cx="160" cy="80" rx="210" ry="55" fill="none" stroke="rgba(196,181,253,0.04)" strokeWidth="10" />
          {/* Stars — varied brightness */}
          {Array.from({ length: 55 }, (_, i) => (
            <circle key={i}
              cx={(i * 83 + 17) % 320} cy={(i * 53 + 11) % 200}
              r={i%7===0 ? 2 : i%3===0 ? 1.2 : 0.6}
              fill="white" opacity={0.3 + (i % 5) * 0.12}
              style={{ animation: `weatherGlowPulse ${1.2+(i%5)*0.4}s ease-in-out ${i*0.12}s infinite` }} />
          ))}
          {/* Shooting star 1 */}
          <line x1="260" y1="20" x2="190" y2="65" stroke="rgba(255,255,255,0.7)" strokeWidth="1.2"
            strokeLinecap="round" style={{ animation: "weatherParticleSun 5s ease-out 0.5s infinite" }} />
          {/* Shooting star 2 */}
          <line x1="100" y1="15" x2="40" y2="50" stroke="rgba(255,255,255,0.5)" strokeWidth="0.8"
            strokeLinecap="round" style={{ animation: "weatherParticleSun 5s ease-out 2.8s infinite" }} />
          {/* Crescent moon */}
          <circle cx="275" cy="35" r="22" fill="rgba(254,240,138,0.14)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <path d="M272 20 A16 16 0 1 0 290 36 A20 20 0 0 1 272 20 Z" fill="rgba(253,224,71,0.65)"/>
          {/* Warm sea glow at bottom */}
          <ellipse cx="160" cy="200" rx="200" ry="30" fill="rgba(56,189,248,0.06)" style={{ animation: "weatherCloudBob 6s ease-in-out infinite" }}/>
        </g>
      ) : (
        /* Day: blazing tropical scene */
        <g>
          <rect width="320" height="200" fill="url(#summerSunGlow)" />
          {/* Sun halo rings */}
          <circle cx="285" cy="28" r="70" fill="rgba(251,191,36,0.05)" style={{ animation: "weatherSunHalo 3s ease-in-out infinite" }}/>
          <circle cx="285" cy="28" r="50" fill="rgba(251,191,36,0.08)" style={{ animation: "weatherSunHalo 2.5s ease-in-out 0.5s infinite" }}/>
          <circle cx="285" cy="28" r="30" fill="rgba(251,191,36,0.12)" style={{ animation: "weatherSunHalo 2s ease-in-out 1s infinite" }}/>
          {/* Sun rays */}
          {Array.from({length:12},(_, i) => {
            const a = (i/12)*Math.PI*2;
            return <line key={i} x1={285+Math.cos(a)*32} y1={28+Math.sin(a)*32} x2={285+Math.cos(a)*52} y2={28+Math.sin(a)*52}
              stroke="rgba(251,191,36,0.25)" strokeWidth="2" strokeLinecap="round"
              style={{ animation: `weatherRayPulse 2s ease-in-out ${i*0.17}s infinite` }}/>;
          })}
          <circle cx="285" cy="28" r="18" fill="rgba(251,191,36,0.9)"/>
          <circle cx="285" cy="28" r="14" fill="#f59e0b"/>
          {/* Tall palm tree — left side */}
          <g opacity="0.22">
            <path d="M55 200 Q52 160 50 120 Q48 90 58 70" stroke="#15803d" strokeWidth="6" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q30 48 10 62" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q85 42 105 55" stroke="#15803d" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q40 50 35 30" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q80 52 88 35" stroke="#15803d" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M58 70 Q60 48 55 25" stroke="#15803d" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
            <circle cx="40" cy="65" r="5" fill="#78350f" opacity="0.6"/>
            <circle cx="74" cy="60" r="4" fill="#78350f" opacity="0.6"/>
          </g>
          {/* Distant palm — right */}
          <g opacity="0.14">
            <path d="M290 200 Q288 170 287 145 Q286 125 292 110" stroke="#166534" strokeWidth="4" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q272 95 258 104" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q312 92 320 102" stroke="#166534" strokeWidth="3" fill="none" strokeLinecap="round"/>
            <path d="M292 112 Q280 96 277 82" stroke="#166534" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
          </g>
          {/* Ocean horizon glow */}
          <ellipse cx="160" cy="200" rx="220" ry="28" fill="rgba(56,189,248,0.18)" />
          {/* Heat shimmer waves */}
          {[0,1,2,3].map(i => (
            <path key={i} d={`M0 ${155+i*12} Q80 ${150+i*12} 160 ${157+i*12} Q240 ${164+i*12} 320 ${155+i*12}`}
              stroke="rgba(251,191,36,0.07)" strokeWidth="3" fill="none"
              style={{ animation: `weatherCloudBob ${2.5+i*0.8}s ease-in-out ${i*0.6}s infinite` }}/>
          ))}
        </g>
      )}
    </svg>
  );
}

function AutumnBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  const trunkColor = tod === "night" ? "#92400e" : "#6b2d0a";
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="autumnMoon" cx="85%" cy="18%" r="20%">
          <stop offset="0%" stopColor="rgba(251,191,36,0.22)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>

      {/* Sky wash */}
      {tod === "night" && <rect width="320" height="200" fill="url(#autumnMoon)" />}

      {/* Large oak tree — left, with full foliage crown */}
      <g opacity={tod === "night" ? 0.28 : 0.32}>
        {/* Trunk + main branches */}
        <line x1="60" y1="200" x2="62" y2="140" stroke={trunkColor} strokeWidth="8" strokeLinecap="round"/>
        <line x1="62" y1="140" x2="45" y2="90" stroke={trunkColor} strokeWidth="5.5" strokeLinecap="round"/>
        <line x1="62" y1="140" x2="85" y2="100" stroke={trunkColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="45" y1="90" x2="28" y2="55" stroke={trunkColor} strokeWidth="4" strokeLinecap="round"/>
        <line x1="45" y1="90" x2="62" y2="58" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="85" y1="100" x2="105" y2="68" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="85" y1="100" x2="72" y2="72" stroke={trunkColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="28" y1="55" x2="15" y2="28" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="28" y1="55" x2="38" y2="30" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="62" y1="58" x2="52" y2="35" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="62" y1="58" x2="75" y2="35" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="105" y1="68" x2="118" y2="42" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="105" y1="68" x2="96" y2="42" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Foliage cloud clusters — warm autumn colors */}
        {[
          [20, 22, 35, tod === "night" ? "rgba(154,52,18,0.55)" : "rgba(234,88,12,0.60)"],
          [40, 28, 30, tod === "night" ? "rgba(180,83,9,0.50)" : "rgba(245,158,11,0.58)"],
          [62, 30, 28, tod === "night" ? "rgba(161,47,0,0.55)" : "rgba(220,38,38,0.55)"],
          [80, 38, 32, tod === "night" ? "rgba(154,52,18,0.45)" : "rgba(234,88,12,0.50)"],
          [105, 45, 30, tod === "night" ? "rgba(120,53,15,0.50)" : "rgba(202,138,4,0.55)"],
          [48, 55, 25, tod === "night" ? "rgba(180,83,9,0.40)" : "rgba(249,115,22,0.50)"],
          [72, 55, 22, tod === "night" ? "rgba(161,47,0,0.40)" : "rgba(239,68,68,0.48)"],
          [28, 50, 20, tod === "night" ? "rgba(120,53,15,0.35)" : "rgba(202,138,4,0.45)"],
          [95, 60, 20, tod === "night" ? "rgba(154,52,18,0.35)" : "rgba(234,88,12,0.42)"],
        ].map(([cx, cy, r, fill], i) => (
          <ellipse key={i} cx={cx as number} cy={cy as number} rx={(r as number) * 1.4} ry={r as number}
            fill={fill as string}
            style={{ animation: `weatherCloudBob ${3.5+i*0.4}s ease-in-out ${i*0.25}s infinite` }}/>
        ))}
      </g>

      {/* Smaller bare tree — right */}
      <g opacity={tod === "night" ? 0.20 : 0.22}>
        <line x1="280" y1="200" x2="278" y2="155" stroke={trunkColor} strokeWidth="5" strokeLinecap="round"/>
        <line x1="278" y1="155" x2="265" y2="115" stroke={trunkColor} strokeWidth="3.5" strokeLinecap="round"/>
        <line x1="278" y1="155" x2="295" y2="125" stroke={trunkColor} strokeWidth="3" strokeLinecap="round"/>
        <line x1="265" y1="115" x2="252" y2="88" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="265" y1="115" x2="274" y2="88" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        <line x1="295" y1="125" x2="308" y2="100" stroke={trunkColor} strokeWidth="2.5" strokeLinecap="round"/>
        <line x1="295" y1="125" x2="285" y2="100" stroke={trunkColor} strokeWidth="2" strokeLinecap="round"/>
        {/* Small foliage clumps */}
        {[
          [252, 82, 18, tod === "night" ? "rgba(180,83,9,0.40)" : "rgba(234,88,12,0.45)"],
          [278, 82, 16, tod === "night" ? "rgba(154,52,18,0.35)" : "rgba(245,158,11,0.40)"],
          [308, 94, 15, tod === "night" ? "rgba(120,53,15,0.35)" : "rgba(220,38,38,0.40)"],
        ].map(([cx, cy, r, fill], i) => (
          <ellipse key={i} cx={cx as number} cy={cy as number} rx={(r as number)*1.3} ry={r as number}
            fill={fill as string}
            style={{ animation: `weatherCloudBob ${4+i*0.5}s ease-in-out ${i*0.3}s infinite` }}/>
        ))}
      </g>

      {/* Harvest moon (night) or warm sun (day) */}
      {tod === "night" ? (
        <g>
          <circle cx="240" cy="30" r="36" fill="rgba(251,191,36,0.10)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
          <circle cx="240" cy="30" r="24" fill="rgba(251,191,36,0.18)"/>
          <circle cx="240" cy="30" r="18" fill="rgba(253,224,71,0.55)"/>
          <circle cx="233" cy="24" r="5" fill="rgba(245,158,11,0.3)"/>
          <circle cx="245" cy="32" r="3" fill="rgba(245,158,11,0.25)"/>
        </g>
      ) : (
        <g>
          <circle cx="260" cy="25" r="45" fill="rgba(251,191,36,0.10)" style={{ animation: "weatherSunHalo 3.5s ease-in-out infinite" }}/>
          <circle cx="260" cy="25" r="28" fill="rgba(251,191,36,0.18)"/>
        </g>
      )}

      {/* Rolling ground */}
      <path d="M0 185 Q55 175 110 182 Q165 189 220 178 Q270 167 320 178 L320 200 L0 200 Z"
        fill={tod === "night" ? "rgba(120,53,15,0.18)" : "rgba(146,64,14,0.28)"} />

      {/* Fog banks */}
      {[0,1,2].map(i => (
        <ellipse key={i} cx={70+i*90} cy={190+i*6} rx={85+i*15} ry={22+i*4}
          fill={tod === "night" ? `rgba(180,140,100,0.06)` : `rgba(253,186,116,0.10)`}
          style={{ animation: `weatherCloudBob ${5+i*2}s ease-in-out ${i}s infinite` }} />
      ))}
    </svg>
  );
}

function WinterBackdrop({ tod }: { tod: TimeOfDayFlag }) {
  const iceColor = tod === "night" ? "rgba(147,197,253,0.30)" : "rgba(219,234,254,0.55)";
  const snowColor = tod === "night" ? "rgba(186,230,253,0.14)" : "rgba(219,234,254,0.50)";
  const treeColor = tod === "night" ? "#1e3a5f" : "#1d4ed8";

  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="auroraGrad1" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(52,211,153,0)" />
          <stop offset="30%" stopColor="rgba(52,211,153,0.22)" />
          <stop offset="70%" stopColor="rgba(99,102,241,0.18)" />
          <stop offset="100%" stopColor="rgba(99,102,241,0)" />
        </linearGradient>
        <linearGradient id="auroraGrad2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(167,139,250,0)" />
          <stop offset="40%" stopColor="rgba(167,139,250,0.16)" />
          <stop offset="60%" stopColor="rgba(52,211,153,0.12)" />
          <stop offset="100%" stopColor="rgba(52,211,153,0)" />
        </linearGradient>
        <linearGradient id="auroraGrad3" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="rgba(236,72,153,0)" />
          <stop offset="50%" stopColor="rgba(236,72,153,0.10)" />
          <stop offset="100%" stopColor="rgba(147,197,253,0)" />
        </linearGradient>
      </defs>

      {/* Aurora borealis bands (night) */}
      {tod === "night" && (
        <g>
          <path d="M-20 55 Q80 15 160 45 Q240 75 340 35" stroke="url(#auroraGrad1)" strokeWidth="30" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 7s ease-in-out infinite" }} />
          <path d="M-20 75 Q90 35 175 60 Q260 85 340 50" stroke="url(#auroraGrad2)" strokeWidth="22" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 9s ease-in-out 1.5s infinite" }} />
          <path d="M-20 95 Q100 50 185 75 Q265 100 340 65" stroke="url(#auroraGrad3)" strokeWidth="15" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 8s ease-in-out 3s infinite" }} />
          <path d="M-20 115 Q110 65 195 90 Q270 115 340 80" stroke="url(#auroraGrad1)" strokeWidth="10" fill="none" strokeLinecap="round"
            style={{ animation: "weatherAuroraPulse 6s ease-in-out 4.5s infinite" }} />
          {/* Stars */}
          {Array.from({ length: 30 }, (_, i) => (
            <circle key={i} cx={(i * 97 + 23) % 320} cy={(i * 41 + 8) % 130} r={0.5 + (i % 3) * 0.6}
              fill="white" opacity={0.35 + (i % 4) * 0.12}
              style={{ animation: `weatherGlowPulse ${1.8+(i%4)*0.4}s ease-in-out ${i*0.1}s infinite` }}/>
          ))}
          {/* Moon */}
          <circle cx="265" cy="28" r="30" fill="rgba(147,197,253,0.10)" style={{ animation: "weatherSunHalo 6s ease-in-out infinite" }}/>
          <circle cx="265" cy="28" r="18" fill="rgba(186,230,253,0.22)"/>
          <path d="M263 14 A16 16 0 1 0 281 30 A20 20 0 0 1 263 14 Z" fill="rgba(219,234,254,0.65)"/>
        </g>
      )}

      {/* Day: bright overcast glow */}
      {tod === "day" && (
        <g>
          <circle cx="160" cy="-10" r="80" fill="rgba(219,234,254,0.30)" style={{ animation: "weatherSunHalo 5s ease-in-out infinite" }}/>
        </g>
      )}

      {/* Dense pine forest — left */}
      {[0, 30, 58].map((ox, j) => (
        <g key={j} opacity={0.22 - j*0.04}>
          <polygon points={`${ox+10} 200,${ox+36} 200,${ox+23} 145`} fill={treeColor} />
          <polygon points={`${ox+5} 168,${ox+41} 168,${ox+23} 120`} fill={treeColor} />
          <polygon points={`${ox+10} 143,${ox+36} 143,${ox+23} 100`} fill={treeColor} />
          <polygon points={`${ox+14} 120,${ox+32} 120,${ox+23} 82`} fill={treeColor} />
          {/* Snow caps on each tier */}
          <ellipse cx={ox+23} cy={145} rx="14" ry="4" fill={iceColor}/>
          <ellipse cx={ox+23} cy={120} rx="12" ry="3.5" fill={iceColor}/>
          <ellipse cx={ox+23} cy={100} rx="10" ry="3" fill={iceColor}/>
          <ellipse cx={ox+23} cy={82} rx="7" ry="2.5" fill={iceColor}/>
        </g>
      ))}

      {/* Dense pine forest — right */}
      {[250, 278, 305].map((ox, j) => (
        <g key={j} opacity={0.20 - j*0.03}>
          <polygon points={`${ox+10} 200,${ox+36} 200,${ox+23} 150`} fill={treeColor} />
          <polygon points={`${ox+4} 172,${ox+42} 172,${ox+23} 125`} fill={treeColor} />
          <polygon points={`${ox+10} 148,${ox+36} 148,${ox+23} 108`} fill={treeColor} />
          <ellipse cx={ox+23} cy={150} rx="14" ry="4" fill={iceColor}/>
          <ellipse cx={ox+23} cy={125} rx="12" ry="3.5" fill={iceColor}/>
          <ellipse cx={ox+23} cy={108} rx="9" ry="3" fill={iceColor}/>
        </g>
      ))}

      {/* Icicles row — varied lengths */}
      {Array.from({length: 14}, (_, i) => {
        const x = 8 + i * 22;
        const h = 8 + (i % 4) * 7;
        return (
          <g key={i}>
            <path d={`M${x-4} 0 L${x} ${h} L${x+4} 0`} fill={iceColor}/>
            <ellipse cx={x} cy={0} rx="4" ry="2" fill={iceColor}/>
          </g>
        );
      })}

      {/* Snow ground — layered bumps */}
      <path d="M0 182 Q28 172 58 178 Q88 184 118 176 Q148 168 178 175 Q208 182 238 174 Q268 166 298 173 Q312 177 320 175 L320 200 L0 200 Z"
        fill={snowColor} />
      <path d="M0 192 Q50 188 100 191 Q150 194 200 189 Q250 184 320 190 L320 200 L0 200 Z"
        fill={tod === "night" ? "rgba(186,230,253,0.20)" : "rgba(219,234,254,0.65)"} />
      {/* Footprints in snow */}
      {[[80,188],[90,185],[100,188],[110,185]].map(([x,y],i) => (
        <ellipse key={i} cx={x} cy={y} rx="4" ry="2.5" fill={tod === "night" ? "rgba(147,197,253,0.15)" : "rgba(186,230,253,0.35)"}/>
      ))}
    </svg>
  );
}

// ─── Holiday Overlay Art ─────────────────────────────────────────────────────

// Export all backdrops for use in WeatherWidget
export { SpringBackdrop, SummerBackdrop, AutumnBackdrop, WinterBackdrop };
