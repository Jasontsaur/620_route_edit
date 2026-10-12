"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  buildElevationProfile,
  elevationLayers,
  visibleMileageRange,
  mileageRangeTicks,
  type MapViewport,
} from "../lib/elevation";
import { type RouteData } from "../lib/route";

export default function ElevationProfile({
  route,
  viewport,
}: {
  route: RouteData;
  viewport: MapViewport | null;
}) {
  const [referenceId, setReferenceId] = useState<string>();
  const profile = useMemo(
    () => buildElevationProfile(route, referenceId),
    [route, referenceId],
  );

  const range = useMemo(
    () => visibleMileageRange(profile, viewport),
    [profile, viewport],
  );

  const scrollHost = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(760);
  const hasRange = range !== null;
  useEffect(() => {
    const el = scrollHost.current;
    if (!el) return;
    const resize = () => {
      if (el.clientWidth > 0) setChartWidth(el.clientWidth);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [hasRange]);

  const ticks = range ? mileageRangeTicks(range) : [];
  const clipId = useId();
  const axis = range ?? { start: 0, end: profile.meters };
  const axisStart =
    axis.start === axis.end ? Math.max(0, axis.start - 0.5) : axis.start;
  const axisEnd = axis.start === axis.end ? axis.end + 0.5 : axis.end;

  const layers = elevationLayers(route),
    width = Math.max(chartWidth, ticks.length * 54 + 70);
  const left = 54,
    right = width - 20,
    top = 22,
    bottom = 110;
  const x = (meters: number) =>
    left + ((meters - axisStart) / (axisEnd - axisStart || 1)) * (right - left);
  const y = (height: number) =>
    bottom -
    ((height - profile.minElevation) /
      (profile.maxElevation - profile.minElevation)) *
      (bottom - top);
  return (
    <div className="profile-content">
      <label className="profile-reference">
        位置對齊基準
        <select
          aria-label="高程對齊基準路線"
          value={profile.reference.id}
          onChange={(e) => setReferenceId(e.target.value)}
        >
          {layers.map((layer) => (
            <option key={layer.id} value={layer.id}>
              {layer.name}
              {layer.id === "active" ? "（目前編輯）" : ""}
            </option>
          ))}
        </select>
      </label>
      {range ? (
        <div
          ref={scrollHost}
          className="profile-scroll"
          tabIndex={0}
          role="region"
          aria-label="高程圖，可橫向捲動查看每 50 公里刻度"
        >
          <svg
            className="elevation-chart"
            viewBox={`0 0 ${width} 142`}
            style={{ minWidth: width }}
            role="img"
            aria-label="所有路線依地理位置對齊的高程曲線，橫軸為基準路線里程，縱軸為公尺"
          >
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={left}
                  y={top - 3}
                  width={right - left}
                  height={bottom - top + 6}
                />
              </clipPath>
            </defs>
            <text x="4" y="10" className="profile-unit">
              高度 m
            </text>
            {profile.elevationTicks.map((height) => (
              <g key={height}>
                <line
                  x1={left}
                  x2={right}
                  y1={y(height)}
                  y2={y(height)}
                  className="profile-grid"
                />
                <text x={left - 8} y={y(height) + 4} textAnchor="end">
                  {height}
                </text>
              </g>
            ))}
            {ticks.map((meters) => (
              <g key={meters}>
                <line
                  x1={x(meters)}
                  x2={x(meters)}
                  y1={top}
                  y2={bottom + 5}
                  className="profile-grid"
                />
                <text x={x(meters)} y={bottom + 21} textAnchor="middle">
                  {Number(
                    (meters / 1000).toFixed(axisEnd - axisStart < 100 ? 2 : 1),
                  )}
                </text>
              </g>
            ))}
            <text x={right} y="141" textAnchor="end" className="profile-unit">
              基準里程 km
            </text>
            {profile.profiles.map((layer, layerIndex) => (
              <g
                key={layer.id}
                aria-label={layer.name}
                clipPath={`url(#${clipId})`}
              >
                {layer.paths.map((path, i) =>
                  path.length > 1 ? (
                    <path
                      key={i}
                      d={path
                        .map(
                          (p, j) =>
                            `${j ? "L" : "M"}${x(p.meters).toFixed(2)},${y(p.elevation).toFixed(2)}`,
                        )
                        .join(" ")}
                      fill="none"
                      stroke={layer.color}
                      strokeWidth={layer.id === "active" ? 2.2 : 3.8}
                      strokeDasharray={
                        layer.id === "active" ? undefined : "6 3"
                      }
                      strokeDashoffset={layerIndex * 3}
                    >
                      <title>{layer.name}</title>
                    </path>
                  ) : (
                    <circle
                      key={i}
                      cx={x(path[0].meters)}
                      cy={y(path[0].elevation)}
                      r={2.2}
                      fill={layer.color}
                    >
                      <title>
                        {layer.name}：{path[0].elevation.toFixed(0)} m
                      </title>
                    </circle>
                  ),
                )}
              </g>
            ))}
          </svg>
        </div>
      ) : (
        <p className="elevation-caption" role="status">
          目前地圖範圍內沒有可對齊的路段，請移動地圖或點「全線」。
        </p>
      )}
      <div className="profile-legend" aria-label="高程曲線圖例">
        {profile.profiles.map((layer) => (
          <span key={layer.id}>
            <i
              style={{
                borderColor: layer.color,
                borderTopStyle: layer.id === "active" ? "solid" : "dashed",
              }}
            />
            {layer.name}
            {!layer.hasElevation
              ? "（無高度資料）"
              : !layer.paths.length
                ? "（無相近路段可對齊）"
                : layer.unmatched
                  ? "（部分路段無法對齊）"
                  : ""}
          </span>
        ))}
      </div>
      <p className="elevation-caption">
        {range && (
          <>
            地圖可見里程：{(range.start / 1000).toFixed(1)}–
            {(range.end / 1000).toFixed(1)} km。移動或縮放地圖會更新範圍。
            <br />
          </>
        )}
        依 GPS 位置對齊；橫軸是「{profile.reference.name}」的里程（全長{" "}
        {(profile.meters / 1000).toFixed(1)} km）。缺少高度或距基準超過 1 km
        的路段留空，不跨軌跡空隙連線。
      </p>
    </div>
  );
}
