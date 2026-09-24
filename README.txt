# CONTROL DE REPARTOS — V1.6.20

## V1.6.20
- Nuevo módulo **Nómina** para consolidar pagos de repartidores a partir de cierres de caja.
- Periodo de pago configurable mediante Fecha inicial y Fecha final; por defecto propone lunes a sábado y permite incluir domingo u otras fechas.
- Liquidación basada en guías entregadas y en la tarifa por guía almacenada en cada cierre.
- Resumen de repartidores, guías entregadas, total a pagar y cierres pendientes.
- Generación de desprendible individual en PDF y PDF consolidado.
- En Cierre de caja, las filas de guías con medio de pago se resaltan visualmente: verde para Efectivo, azul para Transferencia y amarillo para Link de Pago.
- Se mantienen los tres medios de pago: Efectivo, Transferencia y Link de Pago.

## V1.6.19
- La sección **Copias de seguridad** incorpora selección de **Fecha de operación** mediante calendario.
- Se mantiene la opción de **Respaldo completo** de toda la base local.
- El respaldo por Fecha de operación consolida todas las planillas, guías, arqueos, cierres, eventos y repartidores relacionados con la fecha seleccionada.
- El respaldo rápido superior continúa disponible para la jornada activa.


Sistema web local para la gestión operativa de guías, repartidores, asignaciones, entregas, devoluciones, recaudos, arqueos y cierres de caja. La aplicación está diseñada para funcionar inicialmente en un solo computador, utilizando almacenamiento local y copias de seguridad en JSON, sin depender de un servidor para la operación diaria.


## V1.6.18
- Corrección del botón **Ver** en el listado de Guías.
- La consulta de una guía desde el listado abre correctamente la ventana modal de detalles.
- Se conserva la consulta por Fecha de operación y la trazabilidad existente.

## Objetivo
Centralizar el control de las guías y paquetes desde la importación de la planilla hasta la asignación al repartidor, seguimiento del estado, legalización de devoluciones, control de recaudo, arqueo y cierre de caja. La aplicación también permite consultar información histórica por Fecha de operación y generar respaldos del consolidado.

## Módulos

### Dashboard
- Consulta mediante Fecha de operación.
- Consolidación de todas las planillas registradas para la fecha seleccionada.
- Filtro opcional por planilla.
- Estadísticas de total de guías, entregadas, devueltas y recaudo.
- Estado de guías por categorías: Pendiente, Asignado, En reparto, Entregado y Devuelto.
- Control por repartidor.
- Control financiero por medio de pago: Efectivo, Transferencia y Link de Pago.
- Consulta de fechas sin planillas activas.

### Importar jornada
- Importación de planillas en Excel y PDF.
- Lectura y normalización de números de guía.
- Conservación de datos relevantes de la planilla, incluyendo Fecha Planilla y Número de Planilla Reparto.
- Prevención de duplicados mediante Fecha Planilla + Número Planilla Reparto.
- Consolidación de guías por jornada/planilla.

### Guías
- Listado de guías por Fecha de operación.
- Consulta de todas las planillas de una fecha o de una planilla específica.
- Filtros por guía, destinatario, dirección, remitente, ciudad y estado.
- Consulta de trazabilidad de una guía.
- Normalización de códigos de guía sin guiones para facilitar la comparación con lectores de código de barras.
- Cambio controlado del estado de una guía a PENDIENTE cuando sea necesario, eliminando la asignación, medio de pago y datos de entrega/devolución asociados y reabriendo los cierres/jornadas afectados cuando corresponda.

### Repartidores
- Registro de nombre, identificación, teléfono y correo.
- Edición de información personal.
- Validación para impedir la eliminación de repartidores que ya tengan guías asociadas/historial operativo.

### Asignaciones
- Selección de Fecha de operación mediante calendario.
- Consulta de todas las planillas de la fecha seleccionada.
- Posibilidad de limitar la búsqueda a una planilla específica.
- Asignación manual o mediante lector de código de barras.
- Normalización de la guía escaneada para comparar sin guiones.
- Una guía solo puede quedar asociada a un repartidor en la operación correspondiente.
- Si una nueva asignación corresponde a un repartidor que tenía un cierre de caja para esa operación, el cierre se elimina para permitir continuar la operación.
- Estado automático: si la Fecha de operación corresponde al día actual, una guía asignada pasa a EN_REPARTO; en fechas futuras o diferentes permanece ASIGNADA.

### Nómina
- Consulta de periodos de pago configurables.
- Consolidación de cierres de caja por repartidor.
- Cálculo de pago por guía entregada utilizando la tarifa registrada en cada cierre.
- Control de cierres pendientes antes de considerar completa la liquidación.
- Generación de desprendibles individuales y PDF consolidado.
- Preparada para futuras funciones de bonificaciones, descuentos, anticipos y otros conceptos.

### Arqueo
- Selección de Fecha de operación.
- Selección del repartidor con guías asignadas en la fecha seleccionada.
- Lectura de devoluciones mediante código de barras.
- Validación de que la guía escaneada pertenezca al repartidor que está siendo arqueado.
- Una guía ya registrada como devolución no puede registrarse nuevamente.
- Una guía entregada no puede registrarse como devolución.
- Registro del motivo de devolución.
- Confirmación masiva del arqueo para marcar las guías restantes como entregadas.
- Bloqueo del arqueo cuando la caja del repartidor ya está cerrada.

### Cierre de caja
- Selección de Fecha de operación.
- Consulta consolidada de las guías del repartidor en todas las planillas de la fecha.
- Estadísticas de responsabilidad, recaudo, devoluciones y diferencia.
- Medios de pago: Efectivo, Transferencia y Link de Pago.
- Asignación masiva del medio de pago a las guías seleccionadas.
- Validación de guías entregadas con recaudo para exigir un medio de pago válido.
- Las devoluciones no se contabilizan como recaudo recibido.
- Una caja con inconsistencias no puede cerrarse.
- Al confirmar el cierre se solicita el valor a pagar al repartidor por cada guía entregada; el valor predeterminado es $2.000. Este dato se almacena para la futura funcionalidad de nómina.
- Si posteriormente se registra una nueva asignación al mismo repartidor y Fecha de operación, el cierre correspondiente se elimina para permitir la nueva operación.

## Estados de las guías

`PENDIENTE → ASIGNADO → EN_REPARTO → ENTREGADO / DEVUELTO`

- PENDIENTE: guía sin repartidor asignado.
- ASIGNADO: guía asignada a un repartidor, pero la Fecha de operación no corresponde al día actual.
- EN_REPARTO: guía asignada cuya Fecha de operación coincide con la fecha actual.
- ENTREGADO: entrega confirmada.
- DEVUELTO: devolución registrada mediante arqueo y con motivo asociado.

## Medios de pago

La aplicación maneja tres medios de pago para entregas con recaudo:

1. **Efectivo**
2. **Transferencia**
3. **Link de Pago**

Las estadísticas financieras del Dashboard y del Cierre de Caja deben utilizar estos mismos valores para mantener consistencia entre ambos módulos.

## Validaciones operativas

- Una guía no puede estar asignada a dos repartidores en la misma Fecha de operación.
- Una devolución únicamente puede registrarse desde el arqueo del repartidor al que pertenece la guía.
- Un código de barras no puede registrarse dos veces como devolución.
- Una guía inexistente genera una alerta y no se procesa.
- Una entrega con valor de recaudo debe tener Efectivo, Transferencia o Link de Pago.
- Una devolución no genera recaudo.
- No se puede cerrar un repartidor si existen inconsistencias operativas o financieras.
- Una jornada/caja cerrada debe quedar protegida frente a modificaciones incompatibles con su estado.
- Si una nueva asignación afecta un repartidor con cierre para la misma Fecha de operación, el cierre se elimina y la operación vuelve a quedar abierta.
- Un repartidor que ya tuvo asignaciones no puede eliminarse; sus datos personales sí pueden modificarse.
- Una planilla duplicada se identifica mediante la combinación Fecha Planilla + Número Planilla Reparto.

## Normalización de guías

Los lectores de código de barras pueden entregar números con un formato diferente al de la planilla, especialmente por la presencia de guiones. Para evitar diferencias falsas, la aplicación normaliza el número de guía antes de comparar o almacenar la información. La comparación se realiza utilizando el número de guía sin guiones y sin separadores innecesarios.

## Almacenamiento y respaldo

La operación se mantiene local en el computador. Los datos relevantes se almacenan en la base local del navegador y la aplicación dispone de respaldos JSON. En **Copias de seguridad** se puede seleccionar una Fecha de operación mediante calendario para exportar únicamente la información de todas las planillas de esa fecha, y se conserva la opción de **Respaldo completo** para exportar toda la base local. El JSON funciona como copia de seguridad y mecanismo de persistencia externa del consolidado; no requiere un servidor para la operación inicial.

## Operación con múltiples planillas

Una misma Fecha de operación puede tener varias planillas. Dashboard, Guías, Asignaciones, Arqueo y Cierre de Caja deben consultar la fecha seleccionada y consolidar la información de todas las planillas correspondientes, salvo cuando el usuario seleccione explícitamente una planilla determinada.

## Flujo operativo recomendado

1. Importar la planilla diaria en Excel o PDF.
2. Verificar que la Fecha Planilla y el Número de Planilla Reparto no estén duplicados.
3. Seleccionar la Fecha de operación en Asignaciones.
4. Asignar las guías mediante lector o búsqueda manual.
5. Realizar la distribución y seguimiento de entregas.
6. Registrar devoluciones mediante Arqueo y lectura de código de barras.
7. Confirmar el arqueo y marcar como entregadas las guías restantes.
8. Clasificar las entregas con recaudo por Efectivo, Transferencia o Link de Pago.
9. Realizar el Cierre de Caja por repartidor.
10. Registrar el valor por guía entregada solicitado al cerrar.
11. Consultar el Dashboard y generar respaldo cuando sea necesario.

## Evolución del proyecto

### V1.6.11–V1.6.12
- Unificación de la selección de Fecha de operación en Dashboard, Asignaciones, Arqueo y Cierre de Caja.
- Dashboard disponible para consulta de fechas sin planillas activas.
- Asignaciones sobre todas las planillas de la fecha seleccionada o una planilla específica.
- Arqueo y Cierre consultan repartidores y guías según Fecha de operación.

### V1.6.13–V1.6.14
- Consulta de Guías por Fecha de operación.
- Búsqueda de trazabilidad de guías.
- Cambio controlado de una guía a estado PENDIENTE.
- Reapertura de cierres/jornadas afectados por cambios operativos cuando corresponde.
- Mejoras de estabilidad y presentación de las consultas.

### V1.6.15
- Estadística de Link de Pago en Cierre de Caja.
- Solicitud del valor a pagar al repartidor por cada guía entregada, con valor predeterminado de $2.000.
- Almacenamiento del valor por guía y total calculado para futura funcionalidad de nómina.

### V1.6.16
- Versión estable con consolidación de las funcionalidades operativas anteriores.
- README actualizado y renombrado como `README.txt`.
- Incorporación de identidad visual renovada para Control de Repartos.

### V1.6.17
- Incorporación del logotipo definitivo de Control de Repartos en la interfaz y como favicon.
- Ajuste visual del área de marca para una presentación más profesional y consistente con la identidad gráfica.
- El recurso principal de identidad visual es `LogoControlRepartos.png`.

## Identidad visual

El proyecto incorpora el logotipo definitivo `LogoControlRepartos.png`, utilizado en la interfaz principal y como favicon para reforzar la identidad visual de la aplicación.

## Tecnologías

- HTML5
- CSS3
- JavaScript
- IndexedDB / almacenamiento local del navegador
- SheetJS para lectura de Excel
- PDF.js para lectura de PDF
- JSON para copias de seguridad

## Requisitos

- Navegador web moderno con soporte para IndexedDB, JavaScript y `<dialog>`.
- Un computador para la operación inicial.
- Lector de código de barras compatible con entrada de teclado para agilizar asignaciones y arqueos.
- Archivos de planilla en Excel o PDF con el formato operativo definido.

## Autoría

Control de Repartos — Operación local.

By Jeninson Peralta ®
