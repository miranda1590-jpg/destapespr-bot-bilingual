const CIERRE = `

✅ Próximamente nos estaremos comunicando.
Gracias por su patrocinio.
— DestapesPR`;

const RESPUESTAS = {
  destape:
`${TAG} Perfecto. ¿En qué área estás (municipio o sector)?
Luego cuéntame qué línea está tapada (fregadero, inodoro, principal, etc.).
📅 Cita: ${LINK_CITA}${CIERRE}`,

  fuga:
`${TAG} Entendido. ¿Dónde notas la fuga o humedad? ¿Es dentro o fuera de la propiedad?
📅 Cita: ${LINK_CITA}${CIERRE}`,

  camara:
`${TAG} Realizamos inspección con cámara. ¿En qué área la necesitas (baño, cocina, línea principal)?
📅 Cita: ${LINK_CITA}${CIERRE}`,

  calentador:
`${TAG} Revisamos calentadores eléctricos o de gas. ¿Qué tipo tienes y qué problema notas?
📅 Cita: ${LINK_CITA}${CIERRE}`,

  otro:
`${TAG} Cuéntame brevemente qué servicio necesitas y en qué área estás.
📅 Cita: ${LINK_CITA}${CIERRE}`
};