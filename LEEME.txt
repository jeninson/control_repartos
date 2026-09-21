CONTROL DE REPARTOS - V1.6.12
Base: V1.6.11 estable

Cambio principal:
Se unifica la selección de Fecha de operación en Dashboard, Asignaciones, Arqueo y Cierre de Caja.

- Dashboard: consulta por calendario; permite consultar fechas sin planillas activas y conserva el filtro de planilla para la fecha seleccionada.
- Asignaciones: consulta por calendario; busca en todas las planillas de la fecha seleccionada o en una planilla específica. Si no hay planillas, permite seleccionar otra fecha.
- Arqueo: consulta por calendario; conserva selección de repartidor y valida la operación de la fecha seleccionada.
- Cierre de Caja: consulta por calendario y carga los repartidores y guías de la fecha seleccionada.

Se conserva la lógica operativa existente de V1.6.11 y no se cambia el esquema de almacenamiento local.


V1.6.15: Cierre de caja incorpora estadística Link de Pago y solicita al confirmar el cierre el valor por guía entregada (por defecto $2.000), guardándolo para futura nómina.
