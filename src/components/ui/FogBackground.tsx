"use client";

import { useEffect, useRef, useState } from "react";
import { useAtmosphericTheme } from "@/hooks/useAtmosphericTheme";
import { useFogConfig } from "@/hooks/useFogConfig";
import { getFogParams } from "@/lib/fog-weather-mapping";
import type { FogEffect } from "@/lib/vanta-fog";
import type { ShaderOptions } from "@/lib/vanta-shader-base";

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

function hexToNum(hex: string): number {
  const clean = hex.replace("#", "");
  return parseInt(clean, 16);
}

export default function FogBackground() {
  const containerRef = useRef<HTMLDivElement>(null);
  const effectRef = useRef<FogEffect | null>(null);

  const atmosphere = useAtmosphericTheme();
  const { config: fogConfig } = useFogConfig();
  const [weatherCondition, setWeatherCondition] = useState<Condition>("partly-cloudy");
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const lat = 42.7875;
    const lon = -86.1089;
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
  }, []);

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

        const weatherParams = getFogParams(
          weatherCondition,
          atmosphere.isNight,
          atmosphere.holiday,
        );
        const speed = prefersReducedMotion.current ? 0 : fogConfig.speed ?? weatherParams.speed;

        const effect = createFogEffect({
          el: containerRef.current,
          THREE: THREE_MOD as Parameters<typeof createFogEffect>[0]["THREE"],
          baseColor: hexToNum(fogConfig.highlightColor) ?? weatherParams.highlightColor,
          lowlightColor: hexToNum(fogConfig.lowlightColor) ?? weatherParams.lowlightColor,
          midtoneColor: weatherParams.midtoneColor,
          highlightColor: hexToNum(fogConfig.highlightColor) ?? weatherParams.highlightColor,
          blurFactor: fogConfig.blurFactor ?? weatherParams.blurFactor,
          speed,
          zoom: weatherParams.zoom,
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

    const weatherParams = getFogParams(
      weatherCondition,
      atmosphere.isNight,
      atmosphere.holiday,
    );
    const speed = prefersReducedMotion.current ? 0 : fogConfig.speed ?? weatherParams.speed;

    effectRef.current.setOptions({
      baseColor: hexToNum(fogConfig.highlightColor) ?? weatherParams.highlightColor,
      lowlightColor: hexToNum(fogConfig.lowlightColor) ?? weatherParams.lowlightColor,
      midtoneColor: weatherParams.midtoneColor,
      highlightColor: hexToNum(fogConfig.highlightColor) ?? weatherParams.highlightColor,
      blurFactor: fogConfig.blurFactor ?? weatherParams.blurFactor,
      speed,
      zoom: weatherParams.zoom,
    } as unknown as Partial<ShaderOptions>);
  }, [weatherCondition, atmosphere.isNight, atmosphere.holiday, fogConfig.highlightColor, fogConfig.lowlightColor, fogConfig.speed, fogConfig.blurFactor, fogConfig.enabled]);

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