{{- define "rfq-market-maker.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
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
