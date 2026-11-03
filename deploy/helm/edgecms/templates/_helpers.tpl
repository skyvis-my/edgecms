{{- define "edgecms.name" -}}
edgecms
{{- end -}}

{{- define "edgecms.labels" -}}
app.kubernetes.io/name: {{ include "edgecms.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
