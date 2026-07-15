#!/usr/bin/env sh
set -eu

backend_image="${BACKEND_IMAGE_REF:-rfq-backend-rootless:check}"
frontend_image="${FRONTEND_IMAGE_REF:-rfq-frontend-rootless:check}"
run_id="$$"
backend_container="rfq-backend-runtime-${run_id}"
frontend_container="rfq-frontend-runtime-${run_id}"

cleanup() {
  docker rm -f "${backend_container}" "${frontend_container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

test "$(docker image inspect "${backend_image}" --format '{{.Config.User}}')" = "node"
test "$(docker image inspect "${frontend_image}" --format '{{.Config.User}}')" = "nginx"

docker run --rm --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint sh "${backend_image}" -c '
    test "$(id -u)" = 1000
    test "$(id -g)" = 1000
    touch /tmp/runtime-check
    if touch /app/runtime-check 2>/dev/null; then exit 1; fi
  '

docker run --rm --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint sh "${frontend_image}" -c '
    test "$(id -u)" -ne 0
    test "$(id -g)" -ne 0
    touch /tmp/runtime-check
    if touch /usr/share/nginx/html/runtime-check 2>/dev/null; then exit 1; fi
  '

docker run --rm -d --name "${backend_container}" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -e NODE_ENV=development -p 127.0.0.1::3000 "${backend_image}" >/dev/null

docker run --rm -d --name "${frontend_container}" \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1::8080 "${frontend_image}" >/dev/null

backend_port="$(docker port "${backend_container}" 3000/tcp | awk -F: 'END { print $NF }')"
frontend_port="$(docker port "${frontend_container}" 8080/tcp | awk -F: 'END { print $NF }')"

wait_for_url() {
  url="$1"
  attempts=0
  while [ "${attempts}" -lt 30 ]; do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 1
  done
  return 1
}

wait_for_url "http://127.0.0.1:${backend_port}/health"
wait_for_url "http://127.0.0.1:${frontend_port}/"
curl -fsS "http://127.0.0.1:${backend_port}/health" | grep -q '"status":"ok"'
curl -fsS "http://127.0.0.1:${frontend_port}/quotes/runtime-check" | grep -q '<div id="root"></div>'
curl -fsSI "http://127.0.0.1:${frontend_port}/runtime-config.js" | grep -qi 'cache-control: no-store'
curl -fsS "http://127.0.0.1:${frontend_port}/runtime-config.js" | grep -q 'window.__RFQ_RUNTIME_CONFIG__'

echo "Restricted container runtime check passed"
