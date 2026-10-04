"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import { useFogConfig, defaultFogConfig } from "@/hooks/useFogConfig";
import { getFogParams, resolveFogColor } from "@/lib/fog-weather-mapping";
import type { FogEffect } from "@/lib/vanta-fog";
import type { ShaderOptions } from "@/lib/vanta-shader-base";
import { useRuntimeConfig } from "@/hooks/useRuntimeConfig";
import { usePrefersReducedMotion } from "@/hooks/useReducedMotionPreference";

type Condition =
  | "sunny"
  | "partly-cloudy"
  | "cloudy"
  | "rainy"
  | "snowy"
  | "foggy"
  | "thunderstorm";

function wmoToCondition(code: number): Condition {
  if (code === 0) return "sunny";
  if (code <= 3) return "partly-cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "rainy";
  if (code <= 67) return "rainy";
  if (code <= 77) return "snowy";
  if (code <= 82) return "rainy";
  if (code <= 99) return "thunderstorm";
  return "partly-cloudy";
}

export default function FogBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const effectRef = useRef<FogEffect | null>(null);

  const atmosphere = useAtmosphericTheme();
  const { config: fogConfig } = useFogConfig();
  const { runtime } = useRuntimeConfig();
  const [weatherCondition, setWeatherCondition] = useState<Condition>("partly-cloudy");
  // Read the REACTIVE preference, not a mirrored ref: the old code stashed
  // `window.matchMedia` in a ref that only ever saw the OS, so the family's
  // Settings → Appearance toggle left the fog drifting. `reduceMotion` already
  // merges both, and the fog is frozen by handing the shader speed 0.
  const reduceMotion = usePrefersReducedMotion();

  // One resolution of the shader options, shared by init and update so the two
  // can never drift. The palette leg is the resolved THEME (`atmosphere.leg`),
  // because this canvas is opaque and full-viewport: it IS the page's
  // background. `atmosphere.isNight` only moves it within that leg.
  const shaderOptions = useMemo(() => {
    const weatherParams = getFogParams(
      weatherCondition,
      atmosphere.leg,
      atmosphere.holiday,
      atmosphere.isNight,
    );
    const highlight = resolveFogColor(
      fogConfig.highlightColor,
      defaultFogConfig.highlightColor,
      weatherParams.highlightColor,
    );
    const lowlight = resolveFogColor(
      fogConfig.lowlightColor,
      defaultFogConfig.lowlightColor,
      weatherParams.lowlightColor,
    );
    return {
      baseColor: highlight,
      lowlightColor: lowlight,
      midtoneColor: weatherParams.midtoneColor,
      highlightColor: highlight,
      blurFactor: fogConfig.blurFactor ?? weatherParams.blurFactor,
      speed: reduceMotion ? 0 : fogConfig.speed ?? weatherParams.speed,
      zoom: weatherParams.zoom,
    };
  }, [weatherCondition, atmosphere.leg, atmosphere.isNight, atmosphere.holiday, fogConfig.highlightColor, fogConfig.lowlightColor, fogConfig.speed, fogConfig.blurFactor, reduceMotion]);

  useEffect(() => {
    const lat = Number(runtime?.weather_location?.LAT ?? 42.7875);
    const lon = Number(runtime?.weather_location?.LON ?? -86.1089);
    let cancelled = false;

    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=weather_code&forecast_days=1`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const code = data.current?.weather_code ?? 2;
        setWeatherCondition(wmoToCondition(code));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [runtime?.weather_location?.LAT, runtime?.weather_location?.LON]);

  useEffect(() => {
    if (!fogConfig.enabled) {
      if (effectRef.current) {
        effectRef.current.destroy();
        effectRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.style.background = "";
        containerRef.current.innerHTML = "";
      }
      return;
    }

    let cancelled = false;

    const init = async () => {
      try {
        const THREE_MOD = await import("three");
        const { createFogEffect } = await import("@/lib/vanta-fog");

        if (cancelled || !containerRef.current) return;

        const effect = createFogEffect({
          el: containerRef.current,
          THREE: THREE_MOD as Parameters<typeof createFogEffect>[0]["THREE"],
          ...shaderOptions,
          mouseControls: false,
          touchControls: false,
          scale: 1,
          scaleMobile: 1,
          backgroundColor: 0x000000,
          backgroundAlpha: 0,
        });

        effectRef.current = effect;
      } catch (err) {
        console.error("[FogBackground] Failed to initialize:", err);
        if (containerRef.current) {
          containerRef.current.style.background =
            "radial-gradient(ellipse at 50% 80%, rgba(200,192,184,0.25) 0%, transparent 70%)";
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      if (effectRef.current) {
        effectRef.current.destroy();
        effectRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fogConfig.enabled]);

  useEffect(() => {
    if (!effectRef.current || !fogConfig.enabled) return;
    effectRef.current.setOptions(
      shaderOptions as unknown as Partial<ShaderOptions>,
    );
  }, [shaderOptions, fogConfig.enabled]);

  if (!fogConfig.enabled) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}