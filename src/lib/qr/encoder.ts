/**
 * QR code SVG generator using the `qrcode` library.
 * Replaces the previous hand-rolled encoder which had spec compliance issues.
 */
import QRCode from 'qrcode';

export interface QrOptions {
  size?: number;  // SVG size in pixels (default 200)
  fg?: string;    // foreground color (default '#000')
  bg?: string;    // background color (default '#fff')
}

/**
 * Generate a QR code as an SVG string.
 */
export function qrSvg(data: string, opts?: QrOptions): string {
  const svgSize = opts?.size ?? 200;
  const fg = opts?.fg ?? '#000';
  const bg = opts?.bg ?? '#fff';

  // Generate the QR matrix using the library
  const qr = QRCode.create(data, {
    errorCorrectionLevel: 'L',
  });

  const modules = qr.modules;
  const moduleCount = modules.size;
  const totalModules = moduleCount + 8; // 4-module quiet zone each side
  const quietZone = 4;

  let path = '';
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (modules.get(r, c)) {
        const x = quietZone + c;
        const y = quietZone + r;
        path += `M${x},${y}h1v1h-1z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" width="${svgSize}" height="${svgSize}" shape-rendering="crispEdges"><rect width="${totalModules}" height="${totalModules}" fill="${bg}"/><path d="${path}" fill="${fg}"/></svg>`;
}
