import Foundation
import CoreGraphics
import ImageIO
@main struct FrameCacheTest {
    static func main() throws {
        let data = Data([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
        let image = CGImage(width: 2, height: 2, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 8,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: CGDataProvider(data: data as CFData)!, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        let cache = FrozenFrameCache(maxFrames: 1, maxBytes: 16)
        let token = try cache.insert(image, session: "one")
        do { _ = try cache.insert(image, session: "two"); fatalError("capacity was bypassed") } catch {}
        do { _ = try cache.frame(token, session: "two"); fatalError("session isolation failed") } catch {}
        let frozen = try cache.frame(token, session: "one")
        let png = try frozen.png(x: 1, y: 0, width: 1, height: 2)
        let decoded = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithData(png as CFData, nil)!, 0, nil)!
        precondition(decoded.width == 1 && decoded.height == 2)
        var rgba = [UInt8](repeating: 0, count: 8)
        rgba.withUnsafeMutableBytes { raw in
            let context = CGContext(data: raw.baseAddress, width: 1, height: 2, bitsPerComponent: 8, bytesPerRow: 4,
                space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(decoded, in: CGRect(x: 0, y: 0, width: 1, height: 2))
        }
        precondition(rgba == [0, 255, 0, 255, 255, 255, 255, 255], "crop pixels or coordinate orientation changed")
        do { _ = try frozen.png(x: 2, y: 0, width: 1, height: 1); fatalError("bounds bypassed") } catch {}
        cache.release(token, session: "two"); precondition(cache.count == 1)
        cache.release(token, session: "one"); cache.release(token, session: "one"); precondition(cache.count == 0)
        do { _ = try cache.frame(token, session: "one"); fatalError("released frame remained reachable") } catch {}
        _ = try cache.insert(image, session: "three")
        print("Frozen frame cache: pixel crop, capacity, session isolation and release passed")
    }
}
