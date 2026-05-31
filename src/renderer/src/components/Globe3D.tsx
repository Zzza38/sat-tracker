import { useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createWorldMapTextureDataUrl } from "./worldMap";
import type { TrackedSatelliteView } from "./Map2D";

interface Globe3DProps {
  observer: { latitude: number; longitude: number; altitudeM: number };
  satellites: TrackedSatelliteView[];
  currentTime: Date;
  showSunMoon: boolean;
}

const EARTH_RADIUS_M = 6371000;
const FOOTPRINT_HEIGHT_M = 12000;
const FOOTPRINT_SEGMENTS = 144;

function footprintRadiusMeters(altitudeKm: number) {
  return Math.acos(EARTH_RADIUS_M / (EARTH_RADIUS_M + Math.max(altitudeKm, 1) * 1000)) * EARTH_RADIUS_M;
}

function footprintDegrees(latitudeDeg: number, longitudeDeg: number, radiusMeters: number) {
  const centerLatitude = (latitudeDeg * Math.PI) / 180;
  const centerLongitude = (longitudeDeg * Math.PI) / 180;
  const angularRadius = radiusMeters / EARTH_RADIUS_M;
  const sinCenterLatitude = Math.sin(centerLatitude);
  const cosCenterLatitude = Math.cos(centerLatitude);
  const points: number[] = [];

  for (let index = 0; index < FOOTPRINT_SEGMENTS; index += 1) {
    const bearing = (index / FOOTPRINT_SEGMENTS) * Math.PI * 2;
    const latitude = Math.asin(
      sinCenterLatitude * Math.cos(angularRadius) +
        cosCenterLatitude * Math.sin(angularRadius) * Math.cos(bearing)
    );
    const longitude =
      centerLongitude +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularRadius) * cosCenterLatitude,
        Math.cos(angularRadius) - sinCenterLatitude * Math.sin(latitude)
      );
    const normalizedLongitude = ((((longitude * 180) / Math.PI + 540) % 360) - 180);

    points.push(normalizedLongitude, (latitude * 180) / Math.PI, FOOTPRINT_HEIGHT_M);
  }

  return points;
}

function footprintPositions(Cesium: any, satellite: TrackedSatelliteView) {
  const footprintRadius = footprintRadiusMeters(satellite.altitudeKm);
  const footprintPoints = footprintDegrees(satellite.latitudeDeg, satellite.longitudeDeg, footprintRadius);
  return Cesium.Cartesian3.fromDegreesArrayHeights(footprintPoints);
}

function trackRevision(satellite: TrackedSatelliteView) {
  const firstTrackPoint = satellite.groundTrack[0];
  const lastTrackPoint = satellite.groundTrack[satellite.groundTrack.length - 1];
  return firstTrackPoint && lastTrackPoint
    ? `${satellite.groundTrack.length}-${firstTrackPoint.timestamp}-${lastTrackPoint.timestamp}`
    : "empty";
}

function entityStructureKey(satellites: TrackedSatelliteView[]) {
  return satellites
    .map((satellite) =>
      [
        satellite.id,
        satellite.color,
        satellite.selected,
        satellite.name,
        satellite.noradId,
        trackRevision(satellite)
      ].join(":")
    )
    .join("|");
}

function satelliteBillboard(color: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <defs>
        <filter id="glow" x="-45%" y="-45%" width="190%" height="190%">
          <feGaussianBlur stdDeviation="2.4" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <g filter="url(#glow)">
        <rect x="6" y="6" width="52" height="52" rx="14" fill="${color}"/>
        <g fill="none" stroke="#ffffff" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
          <path d="M23.8 38.3c-7.7 5.2-14 7.1-16.1 4.9-3.1-3.1 2.7-13.9 12.9-24.1S41.6 3.2 44.7 6.3c2.2 2.2.3 8.4-4.9 16.1"/>
          <path d="M40.2 25.7c7.7-5.2 14-7.1 16.1-4.9 3.1 3.1-2.7 13.9-12.9 24.1S22.4 60.8 19.3 57.7c-2.2-2.2-.3-8.4 4.9-16.1"/>
          <circle cx="32" cy="32" r="8"/>
          <circle cx="20" cy="20" r="2.5" fill="#ffffff" stroke="none"/>
          <circle cx="44" cy="44" r="2.5" fill="#ffffff" stroke="none"/>
        </g>
      </g>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function setEntityPosition(entity: any, position: any) {
  if (entity.position?.setValue) {
    entity.position.setValue(position);
    return;
  }

  entity.position = position;
}

export function Globe3D({ observer, satellites, currentTime, showSunMoon }: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const cameraInitializedRef = useRef(false);
  const observerEntityRef = useRef<any>(null);
  const satelliteEntityIdsRef = useRef<Set<string>>(new Set());
  const footprintStyleRef = useRef<Map<string, string>>(new Map());
  const trackStyleRef = useRef<Map<string, string>>(new Map());
  const billboardStyleRef = useRef<Map<string, string>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const preUpdateHandlerRef = useRef<(() => void) | null>(null);

  const satellitesRef = useRef(satellites);
  const observerRef = useRef(observer);
  const currentTimeRef = useRef(currentTime);
  const showSunMoonRef = useRef(showSunMoon);
  satellitesRef.current = satellites;
  observerRef.current = observer;
  currentTimeRef.current = currentTime;
  showSunMoonRef.current = showSunMoon;

  const structureKey = entityStructureKey(satellites);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!containerRef.current || viewerRef.current) {
        return;
      }

      (window as any).CESIUM_BASE_URL = import.meta.env.PROD ? "cesium/" : "/cesium/";

      const Cesium = await import("cesium");
      if (cancelled || !containerRef.current) {
        return;
      }

      cesiumRef.current = Cesium;

      const creditContainer = document.createElement("div");
      creditContainer.style.display = "none";

      const worldTexture = await createWorldMapTextureDataUrl();
      if (cancelled || !containerRef.current) {
        return;
      }

      const viewer = new Cesium.Viewer(containerRef.current, {
        animation: false,
        timeline: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        baseLayer: false,
        creditContainer,
        terrainProvider: new Cesium.EllipsoidTerrainProvider()
      });

      viewerRef.current = viewer;
      viewer.scene.globe.show = true;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#101722");
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#080b10");
      viewer.scene.light = new Cesium.SunLight({ intensity: 2.3 });
      viewer.scene.sun = new Cesium.Sun();
      viewer.scene.moon = new Cesium.Moon();

      const controller = viewer.scene.screenSpaceCameraController;
      controller.zoomEventTypes = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
      controller.zoomFactor = 1.45;
      controller.inertiaZoom = 0.08;
      controller.maximumMovementRatio = 0.035;
      controller.minimumZoomDistance = EARTH_RADIUS_M + 500000;
      controller.maximumZoomDistance = EARTH_RADIUS_M + 70000000;

      viewer.imageryLayers.removeAll();
      const worldProvider = await Cesium.SingleTileImageryProvider.fromUrl(worldTexture, {
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
      });
      if (cancelled || !viewerRef.current) {
        return;
      }
      viewer.imageryLayers.addImageryProvider(worldProvider);

      const handlePreUpdate = () => {
        const activeViewer = viewerRef.current;
        const activeCesium = cesiumRef.current;
        if (!activeViewer || !activeCesium) {
          return;
        }

        activeViewer.clock.currentTime = activeCesium.JulianDate.fromDate(currentTimeRef.current);
        if (activeViewer.scene.sun) {
          activeViewer.scene.sun.show = showSunMoonRef.current;
        }
        if (activeViewer.scene.moon) {
          activeViewer.scene.moon.show = showSunMoonRef.current;
        }

        const activeObserver = observerRef.current;
        const observerPosition = activeCesium.Cartesian3.fromDegrees(
          activeObserver.longitude,
          activeObserver.latitude,
          Math.max(activeObserver.altitudeM, 0) + 90000
        );
        if (observerEntityRef.current) {
          setEntityPosition(observerEntityRef.current, observerPosition);
        }
      };

      preUpdateHandlerRef.current = handlePreUpdate;
      viewer.scene.preUpdate.addEventListener(handlePreUpdate);

      viewer.resize();

      const observerEl = new ResizeObserver(() => {
        if (viewerRef.current && containerRef.current && containerRef.current.clientWidth > 0) {
          viewerRef.current.resize();
        }
      });
      observerEl.observe(containerRef.current);
      resizeObserverRef.current = observerEl;

      if (!cancelled) {
        setViewerReady(true);
      }
    }

    void boot();

    return () => {
      cancelled = true;
      setViewerReady(false);
      const viewer = viewerRef.current;
      const handler = preUpdateHandlerRef.current;
      if (viewer && handler) {
        viewer.scene.preUpdate.removeEventListener(handler);
      }
      preUpdateHandlerRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
      cesiumRef.current = null;
      observerEntityRef.current = null;
      satelliteEntityIdsRef.current.clear();
      footprintStyleRef.current.clear();
      trackStyleRef.current.clear();
      billboardStyleRef.current.clear();
      cameraInitializedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !viewerReady) {
      return;
    }

    const activeObserver = observerRef.current;
    const observerPosition = Cesium.Cartesian3.fromDegrees(
      activeObserver.longitude,
      activeObserver.latitude,
      Math.max(activeObserver.altitudeM, 0) + 90000
    );

    if (!observerEntityRef.current) {
      observerEntityRef.current = viewer.entities.add({
        id: "observer",
        position: observerPosition,
        point: {
          pixelSize: 13,
          color: Cesium.Color.fromCssColorString("#e0a458"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        },
        label: {
          text: `Observer
New York`,
          font: "600 13px Inter, sans-serif",
          fillColor: Cesium.Color.fromCssColorString("#f3d29a"),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(14, -12),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        }
      });
    }

    const nextEntityIds = new Set<string>();

    for (const satellite of satellitesRef.current) {
      const satelliteColor = Cesium.Color.fromCssColorString(satellite.color);
      const revision = trackRevision(satellite);
      const satelliteId = satellite.id;

      const footprintId = `${satellite.id}-footprint`;
      nextEntityIds.add(footprintId);
      const footprintEntity = viewer.entities.getById(footprintId) ?? viewer.entities.add({ id: footprintId });
      const footprintStyleKey = `${satellite.color}-${satellite.selected}`;
      if (!footprintEntity.polygon || !footprintEntity.polyline || footprintStyleRef.current.get(footprintId) !== footprintStyleKey) {
        footprintEntity.ellipse = undefined;
        footprintEntity.position = undefined;
        footprintEntity.polygon = {
          hierarchy: new Cesium.CallbackProperty(() => {
            const tracked = satellitesRef.current.find((entry) => entry.id === satelliteId);
            if (!tracked) {
              return new Cesium.PolygonHierarchy([]);
            }

            return new Cesium.PolygonHierarchy(footprintPositions(Cesium, tracked));
          }, false),
          material: satelliteColor.withAlpha(satellite.selected ? 0.2 : 0.12),
          perPositionHeight: true
        };
        footprintEntity.polyline = {
          positions: new Cesium.CallbackProperty(() => {
            const tracked = satellitesRef.current.find((entry) => entry.id === satelliteId);
            if (!tracked) {
              return [];
            }

            const positions = footprintPositions(Cesium, tracked);
            return [...positions, positions[0]];
          }, false),
          width: satellite.selected ? 1.5 : 1,
          material: satelliteColor.withAlpha(satellite.selected ? 0.72 : 0.45),
          clampToGround: false
        };
        footprintStyleRef.current.set(footprintId, footprintStyleKey);
      }

      if (satellite.groundTrack.length > 1) {
        const groundTrackId = `${satellite.id}-ground-track`;
        nextEntityIds.add(groundTrackId);
        const groundTrackEntity = viewer.entities.getById(groundTrackId) ?? viewer.entities.add({ id: groundTrackId });
        const groundTrackStyleKey = `${revision}-${satellite.color}`;
        if (!groundTrackEntity.polyline || trackStyleRef.current.get(groundTrackId) !== groundTrackStyleKey) {
          groundTrackEntity.polyline = {
            positions: Cesium.Cartesian3.fromDegreesArray(
              satellite.groundTrack.flatMap((point) => [point.longitudeDeg, point.latitudeDeg])
            ),
            width: 1,
            material: satelliteColor.withAlpha(0.32),
            clampToGround: false
          };
          trackStyleRef.current.set(groundTrackId, groundTrackStyleKey);
        }
      }

      if (satellite.groundTrack.length > 1) {
        const orbitTrackId = `${satellite.id}-orbit-track`;
        nextEntityIds.add(orbitTrackId);
        const orbitTrackEntity = viewer.entities.getById(orbitTrackId) ?? viewer.entities.add({ id: orbitTrackId });
        const orbitTrackStyleKey = `${revision}-${satellite.color}-${satellite.selected}`;
        if (!orbitTrackEntity.polyline || trackStyleRef.current.get(orbitTrackId) !== orbitTrackStyleKey) {
          orbitTrackEntity.polyline = {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights(
              satellite.groundTrack.flatMap((point) => [
                point.longitudeDeg,
                point.latitudeDeg,
                Math.max(point.altitudeKm, 0) * 1000
              ])
            ),
            width: satellite.selected ? 4 : 2,
            material: satelliteColor.withAlpha(satellite.selected ? 0.95 : 0.58),
            clampToGround: false
          };
          trackStyleRef.current.set(orbitTrackId, orbitTrackStyleKey);
        }
      }

      const satelliteEntityId = `${satellite.id}-satellite`;
      nextEntityIds.add(satelliteEntityId);
      const satelliteEntity = viewer.entities.getById(satelliteEntityId) ?? viewer.entities.add({ id: satelliteEntityId });
      if (!satelliteEntity.position) {
        satelliteEntity.position = new Cesium.CallbackProperty(() => {
          const tracked = satellitesRef.current.find((entry) => entry.id === satelliteId);
          if (!tracked) {
            return Cesium.Cartesian3.ZERO;
          }

          return Cesium.Cartesian3.fromDegrees(
            tracked.longitudeDeg,
            tracked.latitudeDeg,
            tracked.altitudeKm * 1000
          );
        }, false);
      }
      const billboardStyleKey = `${satellite.color}-${satellite.selected}-${satellite.name}-${satellite.noradId}`;
      if (!satelliteEntity.billboard || !satelliteEntity.label || billboardStyleRef.current.get(satelliteEntityId) !== billboardStyleKey) {
        satelliteEntity.billboard = {
          image: satelliteBillboard(satellite.color),
          scale: satellite.selected ? 0.48 : 0.4,
          scaleByDistance: new Cesium.NearFarScalar(
            EARTH_RADIUS_M + 1200000,
            satellite.selected ? 0.48 : 0.4,
            EARTH_RADIUS_M + 65000000,
            satellite.selected ? 0.11 : 0.09
          ),
          alignedAxis: Cesium.Cartesian3.ZERO,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
        satelliteEntity.label = {
          text: `${satellite.name}
NORAD ID ${satellite.noradId}`,
          font: "600 14px Inter, sans-serif",
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(18, -18),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
        billboardStyleRef.current.set(satelliteEntityId, billboardStyleKey);
      }
    }

    for (const entityId of satelliteEntityIdsRef.current) {
      if (!nextEntityIds.has(entityId)) {
        viewer.entities.removeById(entityId);
        footprintStyleRef.current.delete(entityId);
        trackStyleRef.current.delete(entityId);
        billboardStyleRef.current.delete(entityId);
      }
    }
    satelliteEntityIdsRef.current = nextEntityIds;

    const cameraTarget =
      satellitesRef.current.find((satellite) => satellite.selected) ?? satellitesRef.current[0];
    if (cameraTarget && !cameraInitializedRef.current) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          cameraTarget.longitudeDeg,
          cameraTarget.latitudeDeg,
          14000000
        ),
        orientation: {
          heading: 0,
          pitch: Cesium.Math.toRadians(-90),
          roll: 0
        },
        duration: 1.2
      });
      cameraInitializedRef.current = true;
    }
  }, [structureKey, viewerReady]);

  return (
    <div ref={containerRef} className="h-[520px] w-full overflow-hidden rounded-[10px] border border-[var(--line)]" />
  );
}
