[← Volver a la documentación](README.md)

# Instalar y configurar ARCLI

En unos minutos tenés ARCLI instalado, con un ícono en el escritorio, listo para emitir tu primera factura de prueba.

> [!TIP]
> **La forma más fácil:** si usás un asistente de IA que puede manejar tu computadora (Claude, ChatGPT, Gemini, Copilot), copiale el [prompt de instalación](#con-un-asistente-de-ia): hace todo por vos.

## Instalar a mano

Elegí tu sistema.

<!-- arcli: pestañas=so -->

### Windows

1. **Instalá Node.js.** Bajá la versión **LTS** de [nodejs.org](https://nodejs.org/es/download) y abrí el instalador. Siguiente, siguiente, finalizar.
2. **Abrí PowerShell.** Menú Inicio, escribí `PowerShell` y Enter.
3. **Instalá ARCLI.** Con npm (si usás otro gestor: `pnpm add -g arcli` o `yarn global add arcli`):

   ```powershell
   npm install -g arcli
   ```

4. **Creá el ícono en el escritorio:**

   ```powershell
   arcli acceso-directo
   ```

> [!WARNING]
> **"La ejecución de scripts está deshabilitada":** es una protección de PowerShell. La solución está en [problemas frecuentes](troubleshooting.md#powershell-dice-la-ejecución-de-scripts-está-deshabilitada).

### macOS

1. **Instalá Node.js.** Bajá la versión **LTS** de [nodejs.org](https://nodejs.org/es/download) (el instalador `.pkg`) y abrilo.
2. **Abrí la Terminal.** Cmd + Espacio, escribí `Terminal` y Enter.
3. **Instalá ARCLI.** Con npm (si usás otro gestor: `pnpm add -g arcli` o `yarn global add arcli`):

   ```bash
   npm install -g arcli
   ```

4. **Creá el ícono en el escritorio:**

   ```bash
   arcli acceso-directo
   ```

> [!WARNING]
> **Error `EACCES` al instalar:** no uses `sudo`. Mirá cómo resolverlo en [problemas frecuentes](troubleshooting.md#npm-install--g-arcli-falla-con-eacces-macos-o-linux).

### Linux

1. **Instalá Node.js 22.22.1 o superior,** con el gestor de tu distribución o con `nvm`, que evita problemas de permisos.
2. **Instalá ARCLI.** Con npm (si usás otro gestor: `pnpm add -g arcli` o `yarn global add arcli`):

   ```bash
   npm install -g arcli
   ```

3. **Creá el acceso directo:**

   ```bash
   arcli acceso-directo
   ```

## Con un asistente de IA

Copiá esto y pegáselo a tu asistente. Sirve para instalar y para actualizar.

<!-- arcli: prompt-instalacion -->

El texto para copiar está en el [README](../README.md#empezar), en "Que lo instale tu IA".

## Configurar

Abrí ARCLI con doble clic en el ícono. La primera vez, la **configuración guiada** te pide:

- tu **CUIT**,
- el **punto de venta** para web service,
- y el **certificado** de ARCA. Si no lo tenés, lo sacás ahí mismo: [certificado de testing](certificado-testing.md).

> [!NOTE]
> **Todo empieza en testing.** Los comprobantes de testing no tienen validez fiscal. Producción se activa a propósito, cuando estés seguro: [cambiar de entorno](entornos.md).

## Actualizar

Cuando sale una versión nueva, ARCLI te avisa con el comando exacto para el gestor con el que lo instalaste. Es el mismo de la instalación, con `@latest`:

```bash
npm install -g arcli@latest
```

Con pnpm, `pnpm add -g arcli@latest`; con yarn, `yarn global add arcli@latest`. O pegale otra vez el [prompt de instalación](#con-un-asistente-de-ia) a tu asistente de IA: sirve también para actualizar.

> [!NOTE]
> **Yarn 2 o superior** no instala paquetes globales: usá npm o pnpm.
