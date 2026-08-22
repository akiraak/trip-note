import AVKit
import CoreTransferable
import SwiftUI

/// グリッド・地図マーカー用の正方形サムネイル
struct MediaThumbnail: View {
    let media: MediaEntity
    let store: MediaStore

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                let path = store.url(for: media.thumbnailFileName).path(percentEncoded: false)
                if let image = UIImage(contentsOfFile: path) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFill()
                } else {
                    ZStack {
                        Rectangle().fill(.quaternary)
                        Image(systemName: media.type == .video ? "video" : "photo")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .overlay {
                if media.type == .video {
                    Image(systemName: "play.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .shadow(radius: 3)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .contentShape(RoundedRectangle(cornerRadius: 6))
    }
}

/// フルスクリーンのメディアビューア(写真: 表示 / 動画: 再生)
struct MediaViewerView: View {
    let media: MediaEntity
    let store: MediaStore

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            switch media.type {
            case .photo:
                let path = store.url(for: media.fileName).path(percentEncoded: false)
                if let image = UIImage(contentsOfFile: path) {
                    Image(uiImage: image)
                        .resizable()
                        .scaledToFit()
                } else {
                    Text("ファイルが見つかりません")
                        .foregroundStyle(.white)
                }
            case .video:
                if let player {
                    VideoPlayer(player: player)
                }
            }
            VStack {
                HStack {
                    Spacer()
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white.opacity(0.8))
                    }
                    .padding()
                }
                Spacer()
            }
        }
        .onAppear {
            if media.type == .video {
                let player = AVPlayer(url: store.url(for: media.fileName))
                self.player = player
                player.play()
            }
        }
        .onDisappear {
            player?.pause()
        }
    }
}

/// PhotosPicker から動画をメモリに載せずファイルで受け取るための Transferable
struct PickedVideo: Transferable {
    let url: URL

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { video in
            SentTransferredFile(video.url)
        } importing: { received in
            let destination = FileManager.default.temporaryDirectory
                .appending(path: UUID().uuidString + ".mov")
            try FileManager.default.copyItem(at: received.file, to: destination)
            return PickedVideo(url: destination)
        }
    }
}
