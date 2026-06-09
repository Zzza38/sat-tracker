import { useEffect, useRef, useState } from "react";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { createWorldMapTextureDataUrl } from "./worldMap";
import type { TrackedSatelliteView } from "./Map2D";

interface Globe3DProps {
  observer: { name: string; latitude: number; longitude: number; altitudeM: number };
  satellites: TrackedSatelliteView[];
  currentTime: Date;
  showSunMoon: boolean;
  onSatelliteDoubleClick?: (satelliteId: string) => void;
}

const EARTH_RADIUS_M = 6371000;
const FOOTPRINT_SURFACE_HEIGHT_M = 12000;
const FOOTPRINT_SEGMENTS = 48;
const MAX_FOOTPRINTS_WITH_ALL_TRACKED = 30;
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

function entityStructureKey(satellites: TrackedSatelliteView[]) {
  return satellites
    .map((satellite) =>
      [
        satellite.id,
        satellite.color,
        satellite.selected,
        satellite.name,
        trackRevision(satellite)
      ].join(":")
    )
    .join("|");
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
  return ["-footprint", "-ground-track", "-orbit-track"].some((suffix) => entityId.endsWith(suffix));
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

function flyToSatellite(Cesium: any, viewer: any, satellite: TrackedSatelliteView) {
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

export function Globe3D({
  observer,
  satellites,
  currentTime,
  showSunMoon,
  onSatelliteDoubleClick
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

  const satellitesRef = useRef(satellites);
  const satelliteByIdRef = useRef(new Map(satellites.map((satellite) => [satellite.id, satellite])));
  const observerRef = useRef(observer);
  const currentTimeRef = useRef(currentTime);
  const showSunMoonRef = useRef(showSunMoon);
  const onSatelliteDoubleClickRef = useRef(onSatelliteDoubleClick);
  satellitesRef.current = satellites;
  satelliteByIdRef.current = new Map(satellites.map((satellite) => [satellite.id, satellite]));
  observerRef.current = observer;
  currentTimeRef.current = currentTime;
  showSunMoonRef.current = showSunMoon;
  onSatelliteDoubleClickRef.current = onSatelliteDoubleClick;

  const structureKey = entityStructureKey(satellites);
  const footprintKey = footprintUpdateKey(satellites);
  const [viewerReady, setViewerReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      if (!containerRef.current || viewerRef.current) {
        return;
      }

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
      viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK
      );

      const doubleClickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      doubleClickHandler.setInputAction((movement: { position: any }) => {
        const picked = viewer.scene.pick(movement.position);
        const pickedId = typeof picked?.id?.id === "string" ? picked.id.id : undefined;
        const satelliteId = pickedId ? satelliteIdFromEntityId(pickedId) : null;
        if (satelliteId) {
          onSatelliteDoubleClickRef.current?.(satelliteId);
          const tracked = satelliteByIdRef.current.get(satelliteId);
          if (tracked) {
            flyToSatellite(Cesium, viewer, tracked);
            cameraTargetIdRef.current = satelliteId;
          }
          return;
        }

        if (pickedId && isSatelliteOverlayEntity(pickedId)) {
          return;
        }

        const globePoint = viewer.camera.pickEllipsoid(movement.position, viewer.scene.globe.ellipsoid);
        if (cameraTargetIdRef.current && globePoint) {
          flyToEarth(Cesium, viewer);
          cameraTargetIdRef.current = null;
        }
      }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      doubleClickHandlerRef.current = doubleClickHandler;

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
      const viewer = viewerRef.current;
      const handler = preUpdateHandlerRef.current;
      if (viewer && handler) {
        viewer.scene.preUpdate.removeEventListener(handler);
      }
      preUpdateHandlerRef.current = null;
      doubleClickHandlerRef.current?.destroy?.();
      doubleClickHandlerRef.current = null;
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
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

    for (const satellite of satellitesRef.current) {
      const satelliteColor = Cesium.Color.fromCssColorString(satellite.color);
      const revision = trackRevision(satellite);
      const satelliteId = satellite.id;
      const shouldShowFootprint =
        satellite.selected || satellitesRef.current.length <= MAX_FOOTPRINTS_WITH_ALL_TRACKED;

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
      const billboardStyleKey = `${satellite.color}-${satellite.selected}-${satellite.name}`;
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
          text: satellite.name,
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
        footprintGeometryRef.current.delete(satelliteIdFromEntityId(entityId) ?? entityId);
        trackStyleRef.current.delete(entityId);
        billboardStyleRef.current.delete(entityId);
      }
    }
    satelliteEntityIdsRef.current = nextEntityIds;

    const cameraTarget =
      satellitesRef.current.find((satellite) => satellite.selected) ?? satellitesRef.current[0];
    if (cameraTarget && cameraTargetIdRef.current !== cameraTarget.id) {
      flyToSatellite(Cesium, viewer, cameraTarget);
      cameraTargetIdRef.current = cameraTarget.id;
    }
  }, [structureKey, viewerReady]);

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
  }, [footprintKey, viewerReady]);

  return (
    <div
      ref={containerRef}
      className="h-[380px] w-full overflow-hidden rounded-[10px] border border-[var(--line)] sm:h-[460px] lg:h-[520px]"
      role="img"
      aria-label="Interactive 3D globe showing tracked satellites"
    />
  );
}
