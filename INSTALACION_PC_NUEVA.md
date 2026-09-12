# Configuración de una PC nueva para imprimir tickets

Guía para instalar y dejar el listener ejecutándose automáticamente al iniciar sesión en Windows.

## 1. Instalar Git y Node.js

Abre PowerShell como usuario normal y ejecuta:

```powershell
winget install --id Git.Git -e --source winget
winget install --id OpenJS.NodeJS.LTS -e --source winget
```

Cierra PowerShell, abre una ventana nueva y verifica:

```powershell
git --version
node --version
npm.cmd --version
```

Node.js debe ser versión 18 o superior.

> En PowerShell se usa `npm.cmd` porque algunas computadoras bloquean la ejecución de `npm.ps1`.

## 2. Descargar el proyecto

```powershell
New-Item -ItemType Directory -Path C:\Apps -Force
git clone https://github.com/iaagent21/tickets_bodega.git C:\Apps\tickets_bodega
Set-Location C:\Apps\tickets_bodega
Copy-Item .env.example .env
npm.cmd ci
```

## 3. Identificar la impresora local

Ejecuta:

```powershell
Get-CimInstance Win32_Printer |
Where-Object { $_.Local -eq $true -and $_.Network -eq $false } |
Select-Object Name,Default,PortName,SystemName |
Format-Table -Auto
```

Usa el nombre exacto de la impresora física. No uses impresoras PDF, OneNote, XPS o Fax. La impresora debe ser local; no debe aparecer como una impresora compartida de otra PC.

## 4. Configurar el archivo `.env`

```powershell
notepad C:\Apps\tickets_bodega\.env
```

Configura los valores correspondientes:

```env
STORE_USER_EMAIL=correo_de_la_api
STORE_USER_PASSWORD=contraseña
API_URL=https://ferreteriasgd-api-cb.w8k0jk.easypanel.host
TIENDA=la4ta
AUTO_PRINT=true
PRINTER_NAME=NombreExactoDeLaImpresora
TICKET_CLIENT_ID=pc-tickets-la4ta-03
```

El usuario debe tener acceso activo a la aplicación `etiquetas`, permiso de consulta y acceso a `TIENDA`. La PC no necesita ni debe tener variables o claves de Supabase.

No dejes vacío `PRINTER_NAME`, porque entonces Windows usará la impresora predeterminada, que podría ser una impresora compartida.

Cada PC debe tener un `TICKET_CLIENT_ID` diferente. Para generar uno nuevo:

```powershell
[guid]::NewGuid().ToString()
```

Verifica la configuración sin mostrar la contraseña:

```powershell
Get-Content C:\Apps\tickets_bodega\.env |
Select-String '^(PRINTER_NAME|TICKET_CLIENT_ID|TIENDA|AUTO_PRINT|API_URL)='
```

## 5. Crear el inicio oculto

```powershell
notepad C:\Apps\tickets_bodega\start-listener.vbs
```

Pega y guarda:

```vbscript
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Apps\tickets_bodega"

nodePath = "C:\Program Files\nodejs\node.exe"
scriptPath = "C:\Apps\tickets_bodega\listener.js"

shell.Run Chr(34) & nodePath & Chr(34) & " " & Chr(34) & scriptPath & Chr(34), 0, False
```

## 6. Crear la tarea automática

Pega todo el siguiente comando en una sola línea de PowerShell:

```powershell
$TaskName="Tickets Bodega"; $ProjectPath="C:\Apps\tickets_bodega"; $VbsPath=Join-Path $ProjectPath "start-listener.vbs"; $TaskUser=[System.Security.Principal.WindowsIdentity]::GetCurrent().Name; $WScriptPath="$env:WINDIR\System32\wscript.exe"; Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue; $Action=New-ScheduledTaskAction -Execute $WScriptPath -Argument ('"' + $VbsPath + '"'); $Trigger=New-ScheduledTaskTrigger -AtLogOn -User $TaskUser; $Principal=New-ScheduledTaskPrincipal -UserId $TaskUser -LogonType Interactive -RunLevel Limited; $Settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1); Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Principal $Principal -Settings $Settings -Description "Listener oculto de tickets" -Force; Start-ScheduledTask -TaskName $TaskName
```

## 7. Verificar que inició correctamente

```powershell
Get-ScheduledTask -TaskName "Tickets Bodega" |
Select-Object TaskName,State

Get-ScheduledTaskInfo -TaskName "Tickets Bodega"

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
Where-Object { $_.CommandLine -like "*listener.js*" } |
Select-Object ProcessId,CommandLine
```

La verificación correcta es:

- `State: Ready`.
- `LastTaskResult: 0`.
- Un solo proceso `node.exe` ejecutando `listener.js`.
- Ninguna ventana negra visible.

`Ready` es normal: significa que la tarea quedó preparada para el siguiente inicio de sesión y el listener ya fue iniciado en segundo plano.

## 8. Después de reiniciar la PC

No ejecutes manualmente `node listener.js`, porque podrías crear un segundo listener y provocar impresiones duplicadas.

Después de iniciar sesión, verifica solamente:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
Where-Object { $_.CommandLine -like "*listener.js*" } |
Select-Object ProcessId,CommandLine
```

Debe aparecer una sola fila.
