export type LonLat = readonly [longitudeDeg: number, latitudeDeg: number];

export const WORLD_WIDTH = 1440;
export const WORLD_HEIGHT = 720;
const WORLD_TEXTURE_WIDTH = 4096;
const WORLD_TEXTURE_HEIGHT = 2048;
export const WORLD_MAP_ASSET_URL = `${import.meta.env.BASE_URL}world-map-equirectangular.svg`;

export function projectLonLat([longitudeDeg, latitudeDeg]: LonLat, width = WORLD_WIDTH, height = WORLD_HEIGHT) {
  return {
    x: ((longitudeDeg + 180) / 360) * width,
    y: ((90 - latitudeDeg) / 180) * height
  };
}

export async function createWorldMapTextureDataUrl() {
  const canvas = document.createElement("canvas");
  canvas.width = WORLD_TEXTURE_WIDTH;
  canvas.height = WORLD_TEXTURE_HEIGHT;

  const context = canvas.getContext("2d");
  if (!context) {
    return WORLD_MAP_ASSET_URL;
  }

  const ocean = context.createLinearGradient(0, 0, WORLD_TEXTURE_WIDTH, WORLD_TEXTURE_HEIGHT);
  ocean.addColorStop(0, "#101722");
  ocean.addColorStop(0.55, "#0d1219");
  ocean.addColorStop(1, "#090d12");
  context.fillStyle = ocean;
  context.fillRect(0, 0, WORLD_TEXTURE_WIDTH, WORLD_TEXTURE_HEIGHT);

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("World map image failed to load."));
    element.src = WORLD_MAP_ASSET_URL;
  }).catch(() => null);

  if (!image) {
    return WORLD_MAP_ASSET_URL;
  }

  context.globalAlpha = 0.9;
  context.drawImage(image, 0, 0, WORLD_TEXTURE_WIDTH, WORLD_TEXTURE_HEIGHT);
  context.globalAlpha = 1;

  context.strokeStyle = "rgba(80, 96, 114, 0.28)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(0, WORLD_TEXTURE_HEIGHT / 2);
  context.lineTo(WORLD_TEXTURE_WIDTH, WORLD_TEXTURE_HEIGHT / 2);
  context.moveTo(WORLD_TEXTURE_WIDTH / 2, 0);
  context.lineTo(WORLD_TEXTURE_WIDTH / 2, WORLD_TEXTURE_HEIGHT);
  context.stroke();

  return canvas.toDataURL("image/png");
}
