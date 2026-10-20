// Deterministic RDViewer artwork. SVG counterpart: ../public/icon.svg.
// Regenerate: swift tools/md-viewer/macos/icon-source.swift
import AppKit
import Foundation

let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let iconset = directory.appendingPathComponent("build/RDViewer.iconset")
try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
let colorSpace = CGColorSpaceCreateDeviceRGB()
func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: colorSpace, components: [CGFloat((hex >> 16) & 255) / 255,
        CGFloat((hex >> 8) & 255) / 255, CGFloat(hex & 255) / 255, alpha])!
}
func artwork(_ size: Int) throws -> Data {
    let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8,
        bytesPerRow: size * 4, space: colorSpace,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let scale = CGFloat(size) / 1024
    context.translateBy(x: 0, y: CGFloat(size))
    context.scaleBy(x: scale, y: -scale)
    let tile = CGPath(roundedRect: CGRect(x: 112, y: 112, width: 800, height: 800),
        cornerWidth: 180, cornerHeight: 180, transform: nil)
    context.saveGState()
    context.setShadow(offset: CGSize(width: 0, height: -16 * scale), blur: 34 * scale, color: color(0x291448, 0.26))
    context.setFillColor(color(0x7545bd))
    context.addPath(tile)
    context.fillPath()
    context.restoreGState()
    context.saveGState()
    context.addPath(tile)
    context.clip()
    let gradient = CGGradient(colorsSpace: colorSpace,
        colors: [color(0x9769df), color(0x7545bd), color(0x49267e)] as CFArray,
        locations: [0, 0.52, 1])!
    context.drawLinearGradient(gradient, start: CGPoint(x: 112, y: 112),
        end: CGPoint(x: 912, y: 912), options: [])
    context.restoreGState()
    context.setStrokeColor(color(0xffffff, 0.16))
    context.setLineWidth(2)
    context.addPath(CGPath(roundedRect: CGRect(x: 113, y: 113, width: 798, height: 798),
        cornerWidth: 179, cornerHeight: 179, transform: nil))
    context.strokePath()
    let letter = CGMutablePath()
    letter.move(to: CGPoint(x: 350, y: 292))
    letter.addLine(to: CGPoint(x: 528, y: 292))
    letter.addCurve(to: CGPoint(x: 692, y: 436), control1: CGPoint(x: 636, y: 292), control2: CGPoint(x: 692, y: 348))
    letter.addCurve(to: CGPoint(x: 598, y: 566), control1: CGPoint(x: 692, y: 502), control2: CGPoint(x: 656, y: 548))
    for point in [CGPoint(x: 714, y: 732), CGPoint(x: 594, y: 732), CGPoint(x: 488, y: 578),
                  CGPoint(x: 446, y: 578), CGPoint(x: 446, y: 732), CGPoint(x: 350, y: 732)] { letter.addLine(to: point) }
    letter.closeSubpath()
    letter.move(to: CGPoint(x: 446, y: 382))
    letter.addLine(to: CGPoint(x: 446, y: 490))
    letter.addLine(to: CGPoint(x: 522, y: 490))
    letter.addCurve(to: CGPoint(x: 596, y: 436), control1: CGPoint(x: 571, y: 490), control2: CGPoint(x: 596, y: 472))
    letter.addCurve(to: CGPoint(x: 522, y: 382), control1: CGPoint(x: 596, y: 400), control2: CGPoint(x: 571, y: 382))
    letter.closeSubpath()
    context.saveGState()
    context.addPath(letter)
    context.clip(using: .evenOdd)
    let white = CGGradient(colorsSpace: colorSpace, colors: [color(0xffffff), color(0xeee7fc)] as CFArray, locations: [0, 1])!
    context.drawLinearGradient(white, start: CGPoint(x: 512, y: 292), end: CGPoint(x: 512, y: 732), options: [])
    context.restoreGState()
    let image = NSBitmapImageRep(cgImage: context.makeImage()!)
    return image.representation(using: .png, properties: [:])!
}
for points in [16, 32, 128, 256, 512] {
    for factor in [1, 2] {
        let suffix = factor == 2 ? "@2x" : ""
        let url = iconset.appendingPathComponent("icon_\(points)x\(points)\(suffix).png")
        try artwork(points * factor).write(to: url)
    }
}
try artwork(1024).write(to: directory.appendingPathComponent("app-icon.png"))
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", directory.appendingPathComponent("RDViewer.icns").path]
try task.run()
task.waitUntilExit()
guard task.terminationStatus == 0 else { fatalError("iconutil failed") }
print("Generated RDViewer.icns, app-icon.png, and standard 16–1024 px iconset.")
