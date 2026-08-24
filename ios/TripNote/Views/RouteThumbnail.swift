import SwiftUI

/// 一覧行に出すルートのサムネイル。
/// 行の数だけ MapKit を並べると重いので、地図タイルは読まず座標列の形だけを Canvas で描く。
/// 座標が 1 点も無い旅行(プランに座標未設定しかない等)では地図アイコンのプレースホルダになる
struct RouteThumbnail: View {
    /// 訪問順・記録順の座標列
    let coordinates: [RoutePoint]
    /// 線の色(記録済み = Theme.done / これから = Theme.accent)
    var color: Color = Theme.accent

    var body: some View {
        Canvas { context, size in
            let points = Self.layout(coordinates, in: size, inset: 14)
            guard let first = points.first, let last = points.last else { return }
            if points.count >= 2 {
                var path = Path()
                path.addLines(points)
                context.stroke(
                    path,
                    with: .color(color),
                    style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round)
                )
            }
            // 端点だけ丸で示す(出発 = 緑、終着 = 線と同じ色)
            dot(context, at: first, color: Theme.done)
            if points.count >= 2 {
                dot(context, at: last, color: color)
            }
        }
        .background(Theme.raised)
        .overlay {
            if coordinates.isEmpty {
                Image(systemName: "map")
                    .font(.system(size: 18))
                    .foregroundStyle(Theme.line)
            }
        }
    }

    private func dot(_ context: GraphicsContext, at point: CGPoint, color: Color) {
        let radius: CGFloat = 3.5
        let rect = CGRect(
            x: point.x - radius, y: point.y - radius,
            width: radius * 2, height: radius * 2
        )
        context.fill(Path(ellipseIn: rect.insetBy(dx: -1.5, dy: -1.5)), with: .color(Theme.panel))
        context.fill(Path(ellipseIn: rect), with: .color(color))
    }

    /// 座標列を描画領域に収まる点列へ写す。
    /// 経度は緯度による横の縮みを補正して、地図で見たときの形に近づける
    static func layout(_ coordinates: [RoutePoint], in size: CGSize, inset: CGFloat) -> [CGPoint] {
        guard !coordinates.isEmpty else { return [] }
        let latitudes = coordinates.map(\.latitude)
        let longitudes = coordinates.map(\.longitude)
        guard
            let minLatitude = latitudes.min(), let maxLatitude = latitudes.max(),
            let minLongitude = longitudes.min(), let maxLongitude = longitudes.max()
        else { return [] }

        let shrink = cos((minLatitude + maxLatitude) / 2 * .pi / 180)
        let spanLatitude = max(maxLatitude - minLatitude, 0.0001)
        let spanLongitude = max((maxLongitude - minLongitude) * shrink, 0.0001)
        let boxWidth = max(size.width - inset * 2, 1)
        let boxHeight = max(size.height - inset * 2, 1)
        let scale = min(boxWidth / spanLongitude, boxHeight / spanLatitude)
        let originX = (size.width - spanLongitude * scale) / 2
        let originY = (size.height - spanLatitude * scale) / 2

        return coordinates.map { point in
            CGPoint(
                x: originX + (point.longitude - minLongitude) * shrink * scale,
                // 北が上になるよう緯度は反転する
                y: originY + (maxLatitude - point.latitude) * scale
            )
        }
    }

    /// 長い記録点列をサムネイル用に間引く(形は保ちつつ描画点数を抑える)
    static func sampled(_ coordinates: [RoutePoint], limit: Int = 80) -> [RoutePoint] {
        guard coordinates.count > limit else { return coordinates }
        let step = Double(coordinates.count - 1) / Double(limit - 1)
        return (0..<limit).map { coordinates[Int((Double($0) * step).rounded())] }
    }
}

extension TripEntity {
    /// サムネイルに出す座標列。記録があれば実績の軌跡、無ければプランのチェックポイント
    var thumbnailRoute: [RoutePoint] {
        let recorded = sortedPoints.map {
            RoutePoint(latitude: $0.latitude, longitude: $0.longitude)
        }
        if !recorded.isEmpty {
            return RouteThumbnail.sampled(recorded)
        }
        return sortedDays.flatMap { day in
            day.sortedCheckpoints.compactMap { checkpoint in
                guard
                    let latitude = checkpoint.latitude,
                    let longitude = checkpoint.longitude
                else { return nil }
                return RoutePoint(latitude: latitude, longitude: longitude)
            }
        }
    }
}
