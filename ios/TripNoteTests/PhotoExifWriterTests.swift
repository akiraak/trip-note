import Foundation
import Testing
import UIKit
@testable import TripNote

struct PhotoExifWriterTests {
    private func image(size: CGSize = CGSize(width: 8, height: 6)) -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.blue.setFill()
            context.fill(CGRect(origin: .zero, size: size))
        }
    }

    @Test func 撮影日時をEXIFに書いて読み戻せる() async throws {
        // 端末のタイムゾーンに依らないよう書き込み側のオフセットを固定する
        let takenAt = Date(timeIntervalSince1970: 1_756_000_000)
        let timeZone = try #require(TimeZone(secondsFromGMT: 9 * 3600))
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(),
                takenAt: takenAt,
                coordinate: nil,
                quality: 0.95,
                timeZone: timeZone
            )
        )
        let read = try #require(MediaImporter.exifDate(from: data))
        // EXIF は秒までしか持たない
        #expect(Int(read.timeIntervalSince1970) == Int(takenAt.timeIntervalSince1970))
    }

    @Test func 端末と違うタイムゾーンで書いてもオフセットで復元できる() async throws {
        let takenAt = Date(timeIntervalSince1970: 1_756_000_000)
        let timeZone = try #require(TimeZone(secondsFromGMT: -7 * 3600))
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(),
                takenAt: takenAt,
                coordinate: nil,
                quality: 0.95,
                timeZone: timeZone
            )
        )
        let read = try #require(MediaImporter.exifDate(from: data))
        #expect(Int(read.timeIntervalSince1970) == Int(takenAt.timeIntervalSince1970))
    }

    @Test func 南緯西経の座標を符号込みで読み戻せる() async throws {
        let coordinate = MediaCoordinate.Coordinate(latitude: -33.8688, longitude: -70.6693)
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(), takenAt: Date(), coordinate: coordinate, quality: 0.95
            )
        )
        let read = try #require(MediaImporter.exifCoordinate(from: data))
        #expect(abs(read.latitude - coordinate.latitude) < 0.000_1)
        #expect(abs(read.longitude - coordinate.longitude) < 0.000_1)
    }

    @Test func 北緯東経の座標を読み戻せる() async throws {
        let coordinate = MediaCoordinate.Coordinate(latitude: 35.6812, longitude: 139.7671)
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(), takenAt: Date(), coordinate: coordinate, quality: 0.95
            )
        )
        let read = try #require(MediaImporter.exifCoordinate(from: data))
        #expect(abs(read.latitude - coordinate.latitude) < 0.000_1)
        #expect(abs(read.longitude - coordinate.longitude) < 0.000_1)
    }

    @Test func 座標が無ければGPSを書かない() async throws {
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(), takenAt: Date(), coordinate: nil, quality: 0.95
            )
        )
        #expect(MediaImporter.exifCoordinate(from: data) == nil)
    }

    @Test func 画像として読める大きさで書き出す() async throws {
        let data = try #require(
            await PhotoExifWriter.jpegData(
                from: image(size: CGSize(width: 12, height: 9)),
                takenAt: Date(), coordinate: nil, quality: 0.95
            )
        )
        let decoded = try #require(UIImage(data: data))
        #expect(decoded.size == CGSize(width: 12, height: 9))
    }
}
