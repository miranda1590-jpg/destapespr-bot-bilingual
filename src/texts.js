// Textos ES usados por recordatorios
export const L = {
  es: {
    confirm: ({ name, service, address, date, slot }) =>
      `¡Gracias, ${name}! Tu servicio de ${service} quedó confirmado para el ${date} a las ${slot} en ${address}. Si necesitas reprogramar, responde este mensaje.`,
    r24: ({ service, date, slot }) =>
      `Recordatorio (24h): Mañana ${date} a las ${slot} pasamos para tu servicio de ${service}.`,
    r2: ({ date, slot }) =>
      `Recordatorio (2h): Hoy ${date} a las ${slot} estaremos llegando. ¿Habrá alguien en casa?`,
    thanks: ({ name, service }) =>
      `¡Gracias, ${name}! Esperamos que el servicio de ${service} haya quedado perfecto. Cualquier detalle, avísanos.`,
    review: () =>
      `Tu opinión nos ayuda muchísimo. ¿Podrías dejarnos una reseña rápida? 🙌`
  }
};
