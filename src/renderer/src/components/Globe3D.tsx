import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  Crosshair,
  Home,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Navigation,
  Plus
} from "lucide-react";
import { Button } from "./ui/button";
import type { PassOverlay, TrackerMapLayers } from "./trackerMapTypes";
import { createWorldMapTextureDataUrl } from "./worldMap";
import type { TrackedSatelliteView } from "./Map2D";

interface Globe3DProps {
  observer: { name: string; latitude: number; longitude: number; altitudeM: number };
  satellites: TrackedSatelliteView[];
  currentTime: Date;
  layers: TrackerMapLayers;
  onLayersChange?: (layers: TrackerMapLayers) => void;
  followSelected?: boolean;
  onFollowSelectedChange?: (follow: boolean) => void;
  passOverlay?: PassOverlay | null;
  focusToken?: number;
  immersiveExpand?: boolean;
  onSatelliteSelect?: (satelliteId: string) => void;
  onFallbackTo2D?: () => void;
}

const EARTH_RADIUS_M = 6371000;
const FOOTPRINT_SURFACE_HEIGHT_M = 12000;
const FOOTPRINT_SEGMENTS = 48;
const MAX_FOOTPRINTS_WITH_ALL_TRACKED = 30;
const GLOBE_CAMERA_STORAGE_KEY = "sat-tracker.globe-camera";
const billboardCache = new Map<string, string>();

interface FootprintGeometry {
  key: string;
  hierarchy: any;
  outlinePositions: any[];
}

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

    points.push(normalizedLongitude, (latitude * 180) / Math.PI);
  }

  return points;
}

function footprintPositions(Cesium: any, satellite: TrackedSatelliteView) {
  const footprintRadius = footprintRadiusMeters(satellite.altitudeKm);
  const footprintPoints = footprintDegrees(satellite.latitudeDeg, satellite.longitudeDeg, footprintRadius);
  return Cesium.Cartesian3.fromDegreesArray(footprintPoints);
}

function footprintGeometryKey(satellite: TrackedSatelliteView) {
  return [
    satellite.latitudeDeg.toFixed(2),
    satellite.longitudeDeg.toFixed(2),
    satellite.altitudeKm.toFixed(0)
  ].join(":");
}

function getFootprintGeometry(
  Cesium: any,
  satellite: TrackedSatelliteView,
  cache: Map<string, FootprintGeometry>
) {
  const key = footprintGeometryKey(satellite);
  const cached = cache.get(satellite.id);
  if (cached?.key === key) {
    return cached;
  }

  const positions = footprintPositions(Cesium, satellite);
  const outlinePositions = [...positions, positions[0]];
  const geometry = {
    key,
    hierarchy: new Cesium.PolygonHierarchy(positions),
    outlinePositions
  };
  cache.set(satellite.id, geometry);
  return geometry;
}

function trackRevision(satellite: TrackedSatelliteView) {
  const firstTrackPoint = satellite.groundTrack[0];
  const lastTrackPoint = satellite.groundTrack[satellite.groundTrack.length - 1];
  return firstTrackPoint && lastTrackPoint
    ? `${satellite.groundTrack.length}-${firstTrackPoint.timestamp}-${lastTrackPoint.timestamp}`
    : "empty";
}

function entityStructureKey(satellites: TrackedSatelliteView[], layers: TrackerMapLayers) {
  return [
    layers.tracks,
    layers.footprints,
    layers.labels,
    satellites
      .map((satellite) =>
        [
          satellite.id,
          satellite.color,
          satellite.selected,
          satellite.name,
          trackRevision(satellite)
        ].join(":")
      )
      .join("|")
  ].join("::");
}

function footprintUpdateKey(satellites: TrackedSatelliteView[]) {
  return satellites
    .map((satellite) => `${satellite.id}:${footprintGeometryKey(satellite)}`)
    .join("|");
}

function satelliteIdFromEntityId(entityId: string) {
  const suffix = "-satellite";
  if (entityId.endsWith(suffix)) {
    return entityId.slice(0, -suffix.length);
  }

  return null;
}

function isSatelliteOverlayEntity(entityId: string) {
  return ["-footprint", "-ground-track", "-orbit-track", "-pass-track"].some((suffix) =>
    entityId.endsWith(suffix)
  );
}

function satelliteBillboard(color: string) {
  const cached = billboardCache.get(color);
  if (cached) {
    return cached;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;

  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  context.shadowColor = color;
  context.shadowBlur = 14;
  context.fillStyle = color;
  context.beginPath();
  context.arc(48, 48, 21, 0, Math.PI * 2);
  context.fill();

  context.shadowBlur = 0;
  context.lineWidth = 5;
  context.strokeStyle = "#ffffff";
  context.beginPath();
  context.ellipse(48, 48, 34, 12, -0.72, 0.16, Math.PI * 1.38);
  context.stroke();
  context.beginPath();
  context.ellipse(48, 48, 34, 12, -0.72, Math.PI + 0.16, Math.PI * 2.38);
  context.stroke();

  context.fillStyle = "#ffffff";
  context.beginPath();
  context.arc(48, 48, 7, 0, Math.PI * 2);
  context.fill();

  const dataUrl = canvas.toDataURL("image/png");
  billboardCache.set(color, dataUrl);
  return dataUrl;
}

function setEntityPosition(entity: any, position: any) {
  if (entity.position?.setValue) {
    entity.position.setValue(position);
    return;
  }

  entity.position = position;
}

function setSatelliteCameraPivot(Cesium: any, viewer: any, satellite: TrackedSatelliteView) {
  const transform = Cesium.Transforms.eastNorthUpToFixedFrame(
    Cesium.Cartesian3.fromDegrees(
      satellite.longitudeDeg,
      satellite.latitudeDeg,
      satellite.altitudeKm * 1000
    )
  );
  const inverseTransform = Cesium.Matrix4.inverseTransformation(transform, new Cesium.Matrix4());
  const localCameraPosition = Cesium.Matrix4.multiplyByPoint(
    inverseTransform,
    viewer.camera.positionWC,
    new Cesium.Cartesian3()
  );

  viewer.camera.lookAtTransform(transform, localCameraPosition);
}

function flyToSatellite(Cesium: any, viewer: any, satellite: TrackedSatelliteView, follow: boolean) {
  const satelliteAltitudeM = Math.max(satellite.altitudeKm, 0) * 1000;
  const cameraAltitudeM = Math.max(
    14000000,
    Math.min(70000000, satelliteAltitudeM + Math.max(satelliteAltitudeM * 0.35, 3500000))
  );

  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      satellite.longitudeDeg,
      satellite.latitudeDeg,
      cameraAltitudeM
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    },
    duration: 1.2,
    complete: () => {
      if (follow) {
        const entity = viewer.entities.getById(`${satellite.id}-satellite`);
        if (entity) {
          viewer.trackedEntity = entity;
          return;
        }
      }
      setSatelliteCameraPivot(Cesium, viewer, satellite);
    }
  });
}

function flyToEarth(Cesium: any, viewer: any) {
  viewer.trackedEntity = undefined;
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(0, 18, 26000000),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(-90),
      roll: 0
    },
    duration: 1.0
  });
}

function persistCamera(viewer: any) {
  try {
    const cartographic = viewer.camera.positionCartographic;
    if (!cartographic) {
      return;
    }
    localStorage.setItem(
      GLOBE_CAMERA_STORAGE_KEY,
      JSON.stringify({
        longitude: (cartographic.longitude * 180) / Math.PI,
        latitude: (cartographic.latitude * 180) / Math.PI,
        height: cartographic.height,
        heading: viewer.camera.heading,
        pitch: viewer.camera.pitch,
        roll: viewer.camera.roll
      })
    );
  } catch {
    /* restricted environments */
  }
}

function restoreCamera(Cesium: any, viewer: any) {
  try {
    const raw = JSON.parse(localStorage.getItem(GLOBE_CAMERA_STORAGE_KEY) ?? "null") as {
      longitude: number;
      latitude: number;
      height: number;
      heading: number;
      pitch: number;
      roll: number;
    } | null;
    if (!raw) {
      return false;
    }
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(raw.longitude, raw.latitude, raw.height),
      orientation: {
        heading: raw.heading,
        pitch: raw.pitch,
        roll: raw.roll
      }
    });
    return true;
  } catch {
    return false;
  }
}

export function Globe3D({
  observer,
  satellites,
  currentTime,
  layers,
  onLayersChange,
  followSelected = false,
  onFollowSelectedChange,
  passOverlay = null,
  focusToken = 0,
  immersiveExpand = false,
  onSatelliteSelect,
  onFallbackTo2D
}: Globe3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<any>(null);
  const cesiumRef = useRef<any>(null);
  const cameraTargetIdRef = useRef<string | null>(null);
  const observerEntityRef = useRef<any>(null);
  const satelliteEntityIdsRef = useRef<Set<string>>(new Set());
  const footprintGeometryRef = useRef<Map<string, FootprintGeometry>>(new Map());
  const footprintStyleRef = useRef<Map<string, string>>(new Map());
  const trackStyleRef = useRef<Map<string, string>>(new Map());
  const billboardStyleRef = useRef<Map<string, string>>(new Map());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const preUpdateHandlerRef = useRef<(() => void) | null>(null);
  const doubleClickHandlerRef = useRef<any>(null);
  const clickHandlerRef = useRef<any>(null);
  const mouseMoveHandlerRef = useRef<any>(null);
  const moveEndHandlerRef = useRef<(() => void) | null>(null);

  const satellitesRef = useRef(satellites);
  const satelliteByIdRef = useRef(new Map(satellites.map((satellite) => [satellite.id, satellite])));
  const observerRef = useRef(observer);
  const currentTimeRef = useRef(currentTime);
  const layersRef = useRef(layers);
  const followSelectedRef = useRef(followSelected);
  const passOverlayRef = useRef(passOverlay);
  const onSatelliteSelectRef = useRef(onSatelliteSelect);
  const onFollowSelectedChangeRef = useRef(onFollowSelectedChange);
  satellitesRef.current = satellites;
  satelliteByIdRef.current = new Map(satellites.map((satellite) => [satellite.id, satellite]));
  observerRef.current = observer;
  currentTimeRef.current = currentTime;
  layersRef.current = layers;
  followSelectedRef.current = followSelected;
  passOverlayRef.current = passOverlay;
  onSatelliteSelectRef.current = onSatelliteSelect;
  onFollowSelectedChangeRef.current = onFollowSelectedChange;

  const structureKey = entityStructureKey(satellites, layers);
  const footprintKey = footprintUpdateKey(satellites);
  const passOverlayKey = passOverlay
    ? `${passOverlay.satelliteId}:${passOverlay.aos}:${passOverlay.los}`
    : "none";
  const [viewerReady, setViewerReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [gestureHintVisible, setGestureHintVisible] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const selectedSatellite = useMemo(
    () => satellites.find((satellite) => satellite.selected) ?? satellites[0],
    [satellites]
  );

  function focusSelected(options?: { enableFollow?: boolean }) {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    const target = selectedSatellite;
    if (!viewer || !Cesium || !target) {
      return;
    }
    if (options?.enableFollow) {
      onFollowSelectedChange?.(true);
    }
    flyToSatellite(Cesium, viewer, target, options?.enableFollow ?? followSelectedRef.current);
    cameraTargetIdRef.current = target.id;
    setStatusMessage(`Focused ${target.name}`);
  }

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!containerRef.current || viewerRef.current) {
        return;
      }

      containerRef.current.replaceChildren();
      viewerRef.current = null;

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
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        requestRenderMode: true,
        maximumRenderTimeChange: 0.2
      });

      viewerRef.current = viewer;
      viewer.scene.globe.show = true;
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#101722");
      if (viewer.scene.skyAtmosphere) {
        viewer.scene.skyAtmosphere.show = true;
      }
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

      if (!restoreCamera(Cesium, viewer)) {
        flyToEarth(Cesium, viewer);
      }

      const handlePreUpdate = () => {
        const activeViewer = viewerRef.current;
        const activeCesium = cesiumRef.current;
        if (!activeViewer || !activeCesium) {
          return;
        }

        activeViewer.clock.currentTime = activeCesium.JulianDate.fromDate(currentTimeRef.current);
        if (activeViewer.scene.sun) {
          activeViewer.scene.sun.show = layersRef.current.sunMoon;
        }
        if (activeViewer.scene.moon) {
          activeViewer.scene.moon.show = layersRef.current.sunMoon;
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
        activeViewer.scene.requestRender();
      };

      preUpdateHandlerRef.current = handlePreUpdate;
      viewer.scene.preUpdate.addEventListener(handlePreUpdate);

      const onMoveEnd = () => {
        persistCamera(viewer);
      };
      moveEndHandlerRef.current = onMoveEnd;
      viewer.camera.moveEnd.addEventListener(onMoveEnd);

      viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
      );

      const doubleClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      doubleClickHandler.setInputAction((movement: { position: any }) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = typeof picked?.id?.id === "string" ? picked.id.id : undefined;
        const satelliteId = pickedId ? satelliteIdFromEntityId(pickedId) : null;
        if (satelliteId) {
          onSatelliteSelectRef.current?.(satelliteId);
          const tracked = satelliteByIdRef.current.get(satelliteId);
          if (tracked) {
            onFollowSelectedChangeRef.current?.(true);
            flyToSatellite(Cesium, viewer, tracked, true);
            cameraTargetIdRef.current = satelliteId;
            setStatusMessage(`Following ${tracked.name}`);
          }
          return;
        }

        if (pickedId && isSatelliteOverlayEntity(pickedId)) {
          return;
        }

        const globePoint = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
        if (cameraTargetIdRef.current && globePoint) {
          onFollowSelectedChangeRef.current?.(false);
          flyToEarth(Cesium, viewer);
          cameraTargetIdRef.current = null;
        }
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      doubleClickHandlerRef.current = doubleClickHandler;

      const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      clickHandler.setInputAction((movement: { position: any }) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = typeof picked?.id?.id === "string" ? picked.id.id : undefined;
        const satelliteId = pickedId ? satelliteIdFromEntityId(pickedId) : null;
        if (satelliteId) {
          onSatelliteSelectRef.current?.(satelliteId);
          const tracked = satelliteByIdRef.current.get(satelliteId);
          if (tracked) {
            setStatusMessage(`Selected ${tracked.name}`);
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      clickHandlerRef.current = clickHandler;

      const mouseMoveHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      mouseMoveHandler.setInputAction((movement: { endPosition: any }) => {
        const picked = viewer.scene.pick(movement.endPosition);
        const pickedId = typeof picked?.id?.id === "string" ? picked.id.id : undefined;
        viewer.canvas.style.cursor =
          pickedId && satelliteIdFromEntityId(pickedId) ? "pointer" : "";
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
      mouseMoveHandlerRef.current = mouseMoveHandler;

      viewer.resize();

      const observerEl = new ResizeObserver(() => {
        if (viewerRef.current && containerRef.current && containerRef.current.clientWidth > 0) {
          viewerRef.current.resize();
          viewerRef.current.scene.requestRender();
        }
      });
      observerEl.observe(containerRef.current);
      resizeObserverRef.current = observerEl;

      if (!cancelled) {
        setViewerReady(true);
      }
    }

    boot().catch((error) => {
      console.error("3D globe failed to start:", error);
      if (!cancelled) setBootError(true);
    });

    return () => {
      cancelled = true;
      const viewer = viewerRef.current;
      const handler = preUpdateHandlerRef.current;
      if (viewer && handler) {
        viewer.scene.preUpdate.removeEventListener(handler);
      }
      if (viewer && moveEndHandlerRef.current) {
        viewer.camera.moveEnd.removeEventListener(moveEndHandlerRef.current);
      }
      preUpdateHandlerRef.current = null;
      moveEndHandlerRef.current = null;
      doubleClickHandlerRef.current?.destroy?.();
      doubleClickHandlerRef.current = null;
      clickHandlerRef.current?.destroy?.();
      clickHandlerRef.current = null;
      mouseMoveHandlerRef.current?.destroy?.();
      mouseMoveHandlerRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      if (viewer) {
        persistCamera(viewer);
      }
      viewerRef.current?.destroy?.();
      viewerRef.current = null;
      cesiumRef.current = null;
      observerEntityRef.current = null;
      satelliteEntityIdsRef.current.clear();
      footprintGeometryRef.current.clear();
      footprintStyleRef.current.clear();
      trackStyleRef.current.clear();
      billboardStyleRef.current.clear();
      cameraTargetIdRef.current = null;
    };
  }, [bootAttempt]);

  const handleRetry = () => {
    setBootError(false);
    setViewerReady(false);
    setBootAttempt((attempt) => attempt + 1);
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const coarse = window.matchMedia("(hover: none), (pointer: coarse)").matches;
    if (!coarse) {
      return;
    }
    const storageKey = "sat-tracker.globe-gesture-hint-seen";
    try {
      if (window.localStorage.getItem(storageKey) === "1") {
        return;
      }
      window.localStorage.setItem(storageKey, "1");
    } catch {
      /* ignore */
    }
    setGestureHintVisible(true);
    const timer = window.setTimeout(() => setGestureHintVisible(false), 3400);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!expanded) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    if (!focusToken || !viewerReady) {
      return;
    }
    focusSelected();
  }, [focusToken, viewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewerReady) {
      return;
    }
    viewer.resize();
    viewer.scene.requestRender();
  }, [expanded, viewerReady]);

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
${activeObserver.name}`,
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
    } else {
      observerEntityRef.current.label.text = `Observer
${activeObserver.name}`;
    }

    const nextEntityIds = new Set<string>();
    const activeLayers = layersRef.current;

    for (const satellite of satellitesRef.current) {
      const satelliteColor = Cesium.Color.fromCssColorString(satellite.color);
      const revision = trackRevision(satellite);
      const satelliteId = satellite.id;
      const shouldShowFootprint =
        activeLayers.footprints &&
        (satellite.selected || satellitesRef.current.length <= MAX_FOOTPRINTS_WITH_ALL_TRACKED);

      if (shouldShowFootprint) {
        const footprintId = `${satellite.id}-footprint`;
        nextEntityIds.add(footprintId);
        const footprintEntity = viewer.entities.getById(footprintId) ?? viewer.entities.add({ id: footprintId });
        const footprintStyleKey = `${satellite.color}-${satellite.selected}`;
        if (!footprintEntity.polygon || !footprintEntity.polyline || footprintStyleRef.current.get(footprintId) !== footprintStyleKey) {
          const geometry = getFootprintGeometry(Cesium, satellite, footprintGeometryRef.current);
          footprintEntity.ellipse = undefined;
          footprintEntity.position = undefined;
          footprintEntity.polygon = {
            hierarchy: geometry.hierarchy,
            material: satelliteColor.withAlpha(satellite.selected ? 0.2 : 0.12),
            arcType: Cesium.ArcType.GEODESIC,
            height: FOOTPRINT_SURFACE_HEIGHT_M,
            perPositionHeight: false
          };
          footprintEntity.polyline = {
            positions: geometry.outlinePositions,
            width: satellite.selected ? 1.5 : 1,
            material: satelliteColor.withAlpha(satellite.selected ? 0.72 : 0.45),
            arcType: Cesium.ArcType.GEODESIC,
            clampToGround: false
          };
          footprintStyleRef.current.set(footprintId, footprintStyleKey);
        }
      }

      if (activeLayers.tracks && satellite.groundTrack.length > 1) {
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

      if (activeLayers.tracks && satellite.groundTrack.length > 1) {
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
          const tracked = satelliteByIdRef.current.get(satelliteId);
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
      const showLabel = activeLayers.labels || satellite.selected;
      const billboardStyleKey = `${satellite.color}-${satellite.selected}-${satellite.name}-${showLabel}`;
      if (!satelliteEntity.billboard || !satelliteEntity.label || billboardStyleRef.current.get(satelliteEntityId) !== billboardStyleKey) {
        satelliteEntity.billboard = {
          image: satelliteBillboard(satellite.color),
          scale: satellite.selected ? 0.96 : 0.8,
          scaleByDistance: new Cesium.NearFarScalar(
            EARTH_RADIUS_M + 1200000,
            satellite.selected ? 0.96 : 0.8,
            EARTH_RADIUS_M + 65000000,
            satellite.selected ? 0.22 : 0.18
          ),
          alignedAxis: Cesium.Cartesian3.ZERO,
          disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
        satelliteEntity.label = {
          text: showLabel ? satellite.name : "",
          show: showLabel,
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

    const overlay = passOverlayRef.current;
    if (overlay) {
      const passSatellite = satelliteByIdRef.current.get(overlay.satelliteId);
      if (passSatellite) {
        const aos = new Date(overlay.aos).getTime();
        const los = new Date(overlay.los).getTime();
        const passPoints = passSatellite.groundTrack.filter((point) => {
          const time = new Date(point.timestamp).getTime();
          return time >= aos && time <= los;
        });
        if (passPoints.length > 1) {
          const passTrackId = `${overlay.satelliteId}-pass-track`;
          nextEntityIds.add(passTrackId);
          const passEntity = viewer.entities.getById(passTrackId) ?? viewer.entities.add({ id: passTrackId });
          const passStyleKey = `${passOverlayKey}-${passSatellite.color}`;
          if (!passEntity.polyline || trackStyleRef.current.get(passTrackId) !== passStyleKey) {
            passEntity.polyline = {
              positions: Cesium.Cartesian3.fromDegreesArrayHeights(
                passPoints.flatMap((point) => [
                  point.longitudeDeg,
                  point.latitudeDeg,
                  Math.max(point.altitudeKm, 0) * 1000
                ])
              ),
              width: 5,
              material: Cesium.Color.fromCssColorString(passSatellite.color).withAlpha(0.95),
              clampToGround: false
            };
            trackStyleRef.current.set(passTrackId, passStyleKey);
          }
        }
      }
    }

    for (const entityId of satelliteEntityIdsRef.current) {
      if (!nextEntityIds.has(entityId)) {
        viewer.entities.removeById(entityId);
        footprintStyleRef.current.delete(entityId);
        footprintGeometryRef.current.delete(satelliteIdFromEntityId(entityId) ?? entityId);
        trackStyleRef.current.delete(entityId);
        billboardStyleRef.current.delete(entityId);
      }
    }
    satelliteEntityIdsRef.current = nextEntityIds;

    const cameraTarget =
      satellitesRef.current.find((satellite) => satellite.selected) ?? satellitesRef.current[0];
    if (cameraTarget && cameraTargetIdRef.current !== cameraTarget.id) {
      flyToSatellite(Cesium, viewer, cameraTarget, followSelectedRef.current);
      cameraTargetIdRef.current = cameraTarget.id;
    } else if (cameraTarget && followSelectedRef.current) {
      const entity = viewer.entities.getById(`${cameraTarget.id}-satellite`);
      if (entity && viewer.trackedEntity !== entity) {
        viewer.trackedEntity = entity;
      }
    } else if (!followSelectedRef.current && viewer.trackedEntity) {
      viewer.trackedEntity = undefined;
    }

    viewer.scene.requestRender();
  }, [structureKey, viewerReady, passOverlayKey]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !viewerReady) {
      return;
    }

    for (const satellite of satellitesRef.current) {
      const footprintEntity = viewer.entities.getById(`${satellite.id}-footprint`);
      if (!footprintEntity?.polygon || !footprintEntity.polyline) {
        continue;
      }

      const geometry = getFootprintGeometry(Cesium, satellite, footprintGeometryRef.current);
      footprintEntity.polygon.hierarchy = geometry.hierarchy;
      footprintEntity.polyline.positions = geometry.outlinePositions;
    }
    viewer.scene.requestRender();
  }, [footprintKey, viewerReady]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const Cesium = cesiumRef.current;
    if (!viewer || !Cesium || !viewerReady || !selectedSatellite) {
      return;
    }
    if (followSelected) {
      const entity = viewer.entities.getById(`${selectedSatellite.id}-satellite`);
      if (entity) {
        viewer.trackedEntity = entity;
        cameraTargetIdRef.current = selectedSatellite.id;
      }
    } else if (viewer.trackedEntity) {
      viewer.trackedEntity = undefined;
    }
    viewer.scene.requestRender();
  }, [followSelected, selectedSatellite?.id, viewerReady]);

  function zoomGlobe(direction: 1 | -1) {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    const distance = viewer.camera.positionCartographic?.height ?? EARTH_RADIUS_M * 3;
    viewer.camera.zoomIn(direction * distance * 0.18);
    viewer.scene.requestRender();
  }

  function toggleLayer(key: keyof TrackerMapLayers) {
    onLayersChange?.({ ...layers, [key]: !layers[key] });
  }

  const expandClass = expanded
    ? immersiveExpand
      ? " tracker-map-section-expanded tracker-map-section-immersive"
      : " tracker-map-section-expanded"
    : "";

  const globeSection = (
    <div
      className={`tracker-map-section relative h-[380px] w-full overflow-hidden rounded-[10px] border border-[var(--line)] sm:h-[460px] lg:h-[520px]${expandClass}`}
      data-expanded={expanded ? "true" : "false"}
      data-immersive={expanded && immersiveExpand ? "true" : "false"}
    >
      <div
        ref={containerRef}
        className="absolute inset-0"
        role="application"
        aria-label="Interactive 3D globe showing tracked satellites. Use Focus to frame a satellite on touch devices."
      />

      <div className="tracker-map-chrome pointer-events-none absolute inset-0 z-10 p-2.5 sm:p-3">
        <div className="tracker-map-control-stack pointer-events-auto absolute right-2.5 top-2.5 flex flex-col gap-1.5 sm:right-3 sm:top-3">
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => zoomGlobe(1)}
          >
            <Plus />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Zoom out"
            title="Zoom out"
            onClick={() => zoomGlobe(-1)}
          >
            <Minus />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Focus selected satellite"
            title="Focus selected satellite"
            onClick={() => focusSelected()}
          >
            <Crosshair />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant={followSelected ? "default" : "secondary"}
            size="icon-sm"
            aria-label={followSelected ? "Stop following satellite" : "Follow selected satellite"}
            title={followSelected ? "Stop following" : "Follow selected"}
            aria-pressed={followSelected}
            onClick={() => {
              const next = !followSelected;
              onFollowSelectedChange?.(next);
              if (next) {
                focusSelected({ enableFollow: true });
              }
            }}
          >
            <Navigation />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant="secondary"
            size="icon-sm"
            aria-label="Reset globe view"
            title="Reset globe view"
            onClick={() => {
              const viewer = viewerRef.current;
              const Cesium = cesiumRef.current;
              if (!viewer || !Cesium) {
                return;
              }
              onFollowSelectedChange?.(false);
              flyToEarth(Cesium, viewer);
              cameraTargetIdRef.current = null;
            }}
          >
            <Home />
          </Button>
          <Button
            className="tracker-map-control-btn"
            variant={layersOpen ? "default" : "secondary"}
            size="icon-sm"
            aria-label="Globe layers"
            title="Globe layers"
            aria-pressed={layersOpen}
            onClick={() => setLayersOpen((current) => !current)}
          >
            <Layers />
          </Button>
          <Button
            className="tracker-map-control-btn tracker-map-expand-btn"
            variant="secondary"
            size="icon-sm"
            aria-label={expanded ? "Exit full globe" : "Open full globe"}
            title={expanded ? "Exit full globe" : "Open full globe"}
            aria-pressed={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>

        {layersOpen ? (
          <div className="tracker-map-layers pointer-events-auto absolute right-14 top-2.5 w-[11.5rem] rounded-[10px] border border-[var(--line)] bg-black/55 p-2 text-xs text-[var(--text)] backdrop-blur sm:right-16 sm:top-3">
            {(
              [
                ["tracks", "Orbits / tracks"],
                ["footprints", "Footprints"],
                ["labels", "Labels"],
                ["sunMoon", "Sun / Moon"]
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => toggleLayer(key)}
                />
              </label>
            ))}
          </div>
        ) : null}

        {gestureHintVisible ? (
          <div className="tracker-map-gesture-hint absolute inset-x-0 bottom-3 flex justify-center px-4">
            <p className="rounded-full border border-[var(--line)] bg-black/55 px-3 py-1.5 text-center text-[0.72rem] text-[var(--text)] backdrop-blur">
              Pinch to zoom · Tap Focus to frame · Follow keeps the sat centered
            </p>
          </div>
        ) : null}
      </div>

      {bootError ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-[var(--surface)]/80 p-6 text-center">
          <p className="text-sm font-medium text-[var(--text)]">3D globe could not start</p>
          <p className="text-xs text-[var(--muted)]">WebGL may be unavailable or disabled in this environment.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={handleRetry}>
              Retry
            </Button>
            {onFallbackTo2D ? (
              <Button variant="default" size="sm" onClick={onFallbackTo2D}>
                Back to 2D map
              </Button>
            ) : null}
          </div>
        </div>
      ) : !viewerReady ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--surface)]/60">
          <div className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
            <Loader2 size={16} className="animate-spin" />
            Initializing 3D globe…
          </div>
        </div>
      ) : null}

      <div className="sr-only" role="status" aria-live="polite">
        {statusMessage}
      </div>
    </div>
  );

  if (expanded && typeof document !== "undefined") {
    return (
      <>
        <div
          className="tracker-map-section tracker-map-section-placeholder h-[380px] w-full sm:h-[460px] lg:h-[520px]"
          aria-hidden="true"
        />
        {createPortal(globeSection, document.body)}
      </>
    );
  }

  return globeSection;
}
