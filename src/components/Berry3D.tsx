"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { R3FErrorBoundary } from "@/components/R3FErrorBoundary";
import { Grid, OrbitControls } from "@react-three/drei";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { NearestFilter, TextureLoader } from "three";
import { boneToGeometry, firstBone, type BedrockFile } from "@/lib/bedrock/geo";
import { getBerryPivot } from "@/lib/snack/berry-pivots";

export type BerryBbox = {
  min: [number, number, number];
  max: [number, number, number];
};

type CustomPivot = { cx: number; cy: number; cz: number };

type Props = {
  slug: string;
  fruitModel: string;
  fruitTexture: string | null;
  itemId: string;
  /** When true, the model is recentered visually so its bbox centre sits at
   * the world origin — use for the public berry page, where the user just
   * wants a clean centered preview. */
  centered?: boolean;
  /** Override pivot (in cube space) for the debug tuner. Takes precedence
   * over the pivot saved in `berry-pivots.ts`. */
  customPivot?: CustomPivot | null;
  /** Auto-rotate around Y. Off by default (drag to rotate). */
  spin?: boolean;
  /** Show RGB axes helper. */
  showAxes?: boolean;
  /** Show 1/16 grid on Y=0. */
  showGrid?: boolean;
  /** Show a red cross at the world origin (useful in debug). */
  showOrigin?: boolean;
  /** Notify the parent of the raw bbox (cube units) once the model loads. */
  onBboxComputed?: (b: BerryBbox | null) => void;
  /** Tailwind classes for the wrapper. */
  className?: string;
};

function pixelate(t: THREE.Texture) {
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function resolveTexUrl(fruitTexture: string | null, itemId: string) {
  if (fruitTexture) return `/textures/cobblemon/berries/${fruitTexture}.png`;
  const [ns, raw] = itemId.includes(":")
    ? itemId.split(":", 2)
    : ["cobblemon", itemId];
  if (ns === "minecraft") {
    const name = raw === "enchanted_golden_apple" ? "golden_apple" : raw;
    return `/textures/minecraft/item/${name}.png`;
  }
  if (raw.endsWith("_berry")) return `/textures/cobblemon/item/berries/${raw}.png`;
  return `/textures/cobblemon/item/${raw}.png`;
}

const geoCache = new Map<string, Promise<BedrockFile | null>>();
function loadGeo(fruitModel: string): Promise<BedrockFile | null> {
  const url = `/textures/cobblemon/bedrock/berries/${fruitModel}.geo.json`;
  let p = geoCache.get(url);
  if (!p) {
    // Be defensive: a missing file or a stale path returns 404 HTML, and
    // r.json() then throws SyntaxError. Pre-check the response and parse
    // the body as text + JSON.parse so we can swallow the error cleanly.
    p = fetch(url).then(async (r) => {
      if (!r.ok) return null;
      const text = await r.text();
      try {
        return JSON.parse(text) as BedrockFile;
      } catch {
        return null;
      }
    });
    geoCache.set(url, p);
  }
  return p;
}

/**
 * Standalone berry preview. Used by:
 * - /seasonings/[slug]            — `centered` ON, `spin` ON, no helpers
 * - /debug/berry/[slug]           — controllable, optional sliders
 *
 * Rendered as a full Canvas with OrbitControls so the user can drag/zoom.
 */
export function Berry3D(props: Props) {
  const {
    centered = true,
    spin = false,
    showAxes = false,
    showGrid = false,
    showOrigin = false,
    className,
  } = props;

  // Same defenses as Snack3D — R3F can latch onto a 0x0 wrapper when the
  // page hydrates after a client-side navigation (Cache Components race),
  // and the GPU context can be lost on tab switches. Both leave a blank
  // canvas without these.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const pathname = usePathname();

  useEffect(() => {
    setCanvasKey((k) => k + 1);
  }, [pathname]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setCanvasKey((k) => k + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    let lastZero = host.clientWidth === 0 || host.clientHeight === 0;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const w = e.contentRect.width;
        const h = e.contentRect.height;
        if (lastZero && w > 0 && h > 0) {
          lastZero = false;
          setCanvasKey((k) => k + 1);
        } else if (w === 0 || h === 0) {
          lastZero = true;
        }
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const host = wrapperRef.current;
    if (!host) return;
    const canvas = host.querySelector("canvas");
    if (!canvas) return;
    const onLost = (e: Event) => {
      e.preventDefault();
      setCanvasKey((k) => k + 1);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    return () => canvas.removeEventListener("webglcontextlost", onLost);
  }, [canvasKey]);

  return (
    <div
      ref={wrapperRef}
      className={
        className ??
        "rounded-lg border border-border bg-subtle overflow-hidden h-full min-h-[320px] relative"
      }
    >
      <R3FErrorBoundary>
      <Canvas
        key={canvasKey}
        camera={{ position: [0.6, 0.45, 0.6], fov: 30, near: 0.01, far: 100 }}
        gl={{ preserveDrawingBuffer: true }}
      >
        <color attach="background" args={["#f4f4f5"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 4, 2]} intensity={1.1} />

        {showAxes && <axesHelper args={[0.5]} />}
        {showGrid && (
          <Grid
            args={[2, 2]}
            cellSize={1 / 16}
            cellThickness={0.5}
            cellColor="#888"
            sectionSize={0.25}
            sectionThickness={1}
            sectionColor="#444"
            fadeDistance={3}
            fadeStrength={1}
            position={[0, 0, 0]}
          />
        )}
        {showOrigin && <OriginCross size={0.12} />}

        <Suspense fallback={null}>
          <BerryModel {...props} centered={centered} spin={spin} />
        </Suspense>

        <OrbitControls enablePan enableDamping dampingFactor={0.1} />
      </Canvas>
      </R3FErrorBoundary>
    </div>
  );
}

function BerryModel({
  slug,
  fruitModel,
  fruitTexture,
  itemId,
  centered,
  customPivot,
  spin,
  onBboxComputed,
}: Props) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [rawGeo, setRawGeo] = useState<BedrockFile | null>(null);

  useEffect(() => {
    const url = resolveTexUrl(fruitTexture ?? null, itemId);
    let cancelled = false;
    new TextureLoader().load(
      url,
      (t) => {
        if (cancelled) return;
        pixelate(t);
        setTexture(t);
      },
      undefined,
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [fruitTexture, itemId]);

  useEffect(() => {
    if (!fruitModel) return;
    let cancelled = false;
    loadGeo(fruitModel).then((file) => {
      if (cancelled) return;
      setRawGeo(file);
    });
    return () => {
      cancelled = true;
    };
  }, [fruitModel]);

  // Raw bbox in cube units, used by the debug tuner's slider ranges.
  const bbox = useMemo<BerryBbox | null>(() => {
    if (!rawGeo) return null;
    const g = rawGeo["minecraft:geometry"]?.[0];
    const bone = g ? firstBone(g) : null;
    if (!g || !bone) return null;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const c of bone.cubes ?? []) {
      const [ox, oy, oz] = c.origin;
      const [sx, sy, sz] = c.size;
      if (ox < minX) minX = ox; if (ox + sx > maxX) maxX = ox + sx;
      if (oy < minY) minY = oy; if (oy + sy > maxY) maxY = oy + sy;
      if (oz < minZ) minZ = oz; if (oz + sz > maxZ) maxZ = oz + sz;
    }
    if (!Number.isFinite(minX)) return null;
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  }, [rawGeo]);

  useEffect(() => {
    onBboxComputed?.(bbox ?? null);
  }, [bbox, onBboxComputed]);

  // Pick the pivot to apply: explicit customPivot beats the saved registry,
  // which beats the "centered" auto-fallback (bbox centre).
  const pivot = useMemo<CustomPivot | null>(() => {
    if (customPivot) return customPivot;
    const saved = getBerryPivot(slug);
    if (saved.cx != null || saved.cy != null || saved.cz != null) {
      return { cx: saved.cx ?? 0, cy: saved.cy ?? 0, cz: saved.cz ?? 0 };
    }
    if (centered && bbox) {
      return {
        cx: (bbox.min[0] + bbox.max[0]) / 2,
        cy: (bbox.min[1] + bbox.max[1]) / 2,
        cz: (bbox.min[2] + bbox.max[2]) / 2,
      };
    }
    return null;
  }, [customPivot, slug, centered, bbox]);

  const geometry = useMemo(() => {
    if (!rawGeo) return null;
    const g = rawGeo["minecraft:geometry"]?.[0];
    const bone = g ? firstBone(g) : null;
    if (!g || !bone) return null;
    return boneToGeometry(bone, g, "none", pivot);
  }, [rawGeo, pivot]);

  const material = useMemo(
    () =>
      texture
        ? new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.1,
            side: THREE.DoubleSide,
          })
        : null,
    [texture],
  );

  const ref = useRef<THREE.Mesh>(null);
  useFrame((_state, delta) => {
    if (spin && ref.current) ref.current.rotation.y += delta * 0.4;
  });

  if (!geometry || !material) return null;

  return (
    <mesh
      ref={ref}
      geometry={geometry}
      material={material}
      scale={[1 / 16, 1 / 16, 1 / 16]}
    />
  );
}

function OriginCross({ size }: { size: number }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const s = size;
    const pts = new Float32Array([
      -s, 0, 0, s, 0, 0,
      0, -s, 0, 0, s, 0,
      0, 0, -s, 0, 0, s,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(pts, 3));
    return g;
  }, [size]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#ef4444" />
    </lineSegments>
  );
}
