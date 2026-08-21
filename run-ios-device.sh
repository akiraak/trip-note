#!/usr/bin/env bash
# 実機（iPhone）へ trip-note をビルド・インストールして起動する。
#
#   ./run-ios-device.sh
#   IOS_DEVICE="AkiraのiPhone" ./run-ios-device.sh   # 端末名 or 識別子で選ぶ
#   DEVELOPMENT_TEAM=XXXXXXXXXX ./run-ios-device.sh  # 署名チームを変える
#   IOS_CONSOLE=1 ./run-ios-device.sh                # 起動後にログを流す
set -euo pipefail
cd "$(dirname "$0")/ios"

BUNDLE_ID="com.akiraak.TripNote"
SCHEME="TripNote"
PROJECT="TripNote.xcodeproj"
DERIVED_DATA="build-device"
# 既定は手元の Apple Development 証明書のチーム（Xcode 管理のワイルドカードプロファイルが使える）
TEAM="${DEVELOPMENT_TEAM:-N38G4DGA67}"

for tool in xcodegen xcodebuild; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "エラー: $tool が見つかりません（xcodegen は brew install xcodegen）" >&2
    exit 1
  fi
done

# 接続中の端末を選ぶ。IOS_DEVICE が指定されていれば名前 / 識別子で絞り込む
DEVICES="$(xcrun devicectl list devices 2>/dev/null | grep -i "available" || true)"
if [ -n "${IOS_DEVICE:-}" ]; then
  DEVICES="$(printf '%s\n' "$DEVICES" | grep -F "$IOS_DEVICE" || true)"
fi
DEVICE_LINE="$(printf '%s\n' "$DEVICES" | head -1)"

if [ -z "$DEVICE_LINE" ]; then
  echo "エラー: 使える iOS 端末が見つかりません。USB 接続と Developer Mode を確認してください。" >&2
  echo "--- 認識している端末 ---" >&2
  xcrun devicectl list devices >&2 || true
  exit 1
fi

DEVICE_ID="$(printf '%s' "$DEVICE_LINE" \
  | grep -Eo '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}' \
  | head -1)"
DEVICE_NAME="$(printf '%s' "$DEVICE_LINE" | sed -E 's/ {2,}.*//')"
echo "==> 端末: ${DEVICE_NAME} (${DEVICE_ID})"

echo "==> Xcode プロジェクトを生成 (DEVELOPMENT_TEAM=${TEAM})"
DEVELOPMENT_TEAM="$TEAM" xcodegen generate

echo "==> ビルド"
xcodebuild \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Debug \
  -destination "generic/platform=iOS" \
  -derivedDataPath "$DERIVED_DATA" \
  -quiet \
  build

APP_PATH="${DERIVED_DATA}/Build/Products/Debug-iphoneos/${SCHEME}.app"
if [ ! -d "$APP_PATH" ]; then
  echo "エラー: ${APP_PATH} が作られませんでした" >&2
  exit 1
fi

echo "==> インストール"
if ! xcrun devicectl device install app --device "$DEVICE_ID" "$APP_PATH"; then
  cat >&2 <<'HINT'

端末に接続できませんでした。次を確認してください。
  - iPhone のロックを解除して「このコンピュータを信頼」を済ませる
  - USB で繋ぐ（ワイヤレスの場合は Mac と同じ Wi-Fi にいること）
  - 設定 > プライバシーとセキュリティ > デベロッパモード が オン
HINT
  exit 1
fi

echo "==> 起動"
LAUNCH_ARGS=(--device "$DEVICE_ID" --terminate-existing)
if [ "${IOS_CONSOLE:-}" = "1" ]; then
  LAUNCH_ARGS+=(--console)
fi
if ! xcrun devicectl device process launch "${LAUNCH_ARGS[@]}" "$BUNDLE_ID"; then
  cat >&2 <<'HINT'

インストールは済んでいますが、起動できませんでした。
iPhone がロックされていると起動できません。ロックを解除してから
このスクリプトを再実行するか、ホーム画面のアイコンから起動してください。
HINT
  exit 1
fi
echo "==> 完了"
