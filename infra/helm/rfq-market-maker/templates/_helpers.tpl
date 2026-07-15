{{- define "rfq-market-maker.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "rfq-market-maker.validateShutdownBudget" -}}
{{- $configured := required "env.RFQ_SHUTDOWN_TIMEOUT_MS is required" (index .Values.env "RFQ_SHUTDOWN_TIMEOUT_MS") -}}
{{- if not (regexMatch "^(?:[1-9][0-9]{3,4}|1[01][0-9]{4}|120000)$" $configured) -}}
{{- fail "env.RFQ_SHUTDOWN_TIMEOUT_MS must be an integer between 1000 and 120000" -}}
{{- end -}}
{{- $shutdownMs := int $configured -}}
{{- $requiredMs := add $shutdownMs (mul (add (int .Values.preStopSleepSeconds) 5) 1000) -}}
{{- $graceMs := mul (int .Values.terminationGracePeriodSeconds) 1000 -}}
{{- if gt $requiredMs $graceMs -}}
{{- fail "shutdown timeout plus preStop and 5s safety margin must fit terminationGracePeriodSeconds" -}}
{{- end -}}
{{- end -}}

{{- define "rfq-market-maker.frontendImage" -}}
{{- if .Values.frontend.image.digest -}}
{{- printf "%s@%s" .Values.frontend.image.repository .Values.frontend.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.frontend.image.repository (required "frontend.image.tag is required when frontend.image.digest is empty" .Values.frontend.image.tag) -}}
{{- end -}}
{{- end -}}

{{- define "rfq-market-maker.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "rfq-market-maker.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "rfq-market-maker.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "rfq-market-maker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "rfq-market-maker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rfq-market-maker.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "rfq-market-maker.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (required "image.tag is required when image.digest is empty" .Values.image.tag) -}}
{{- end -}}
{{- end -}}

{{- define "rfq-market-maker.topologySpreadConstraints" -}}
{{- $root := index . 0 -}}
{{- $component := index . 1 -}}
{{- if $root.Values.topologySpread.enabled -}}
{{- range $topologyKey := $root.Values.topologySpread.topologyKeys }}
- maxSkew: {{ $root.Values.topologySpread.maxSkew }}
  minDomains: {{ $root.Values.topologySpread.minDomains }}
  topologyKey: {{ $topologyKey }}
  whenUnsatisfiable: {{ $root.Values.topologySpread.whenUnsatisfiable }}
  labelSelector:
    matchLabels:
      {{- include "rfq-market-maker.selectorLabels" $root | nindent 6 }}
      app.kubernetes.io/component: {{ $component }}
{{- end }}
{{- end }}
{{- end -}}
