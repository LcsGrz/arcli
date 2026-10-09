# Modo interactivo: consultar comprobantes, cargar mas y ver el detalle de uno. Solo lectura, no emite.
# Se graba con scripts/demo/record.sh.
Output docs/assets/demo/consultar.gif

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 1000
Set Padding 20
Set Theme "TokyoNight"
Set WindowBar Colorful
Set TypingSpeed 70ms

Hide
Type "source scripts/demo/setup.sh" Enter
# Listas cortas para que el detalle entre en pantalla junto con la lista (config de demo, no la tuya).
Type "arcli config establecer comprobantesPorLista 5 >/dev/null && clear" Enter
Sleep 1.5s
Show

Type "arcli" Sleep 600ms Enter
Sleep 2.5s
# Consultar comprobantes
Down 4
Sleep 500ms
Enter
Sleep 1s
# Factura C
Down 2
Sleep 500ms
Enter
Sleep 4s
# Hasta "+ Cargar mas…"
Down 5
Sleep 800ms
Enter
Sleep 5s
# El cursor queda en la primera nueva: ver su detalle
Enter
Sleep 4s
# Esc vuelve de la lista al menu, y otro Esc sale
Escape
Sleep 1.5s
Escape
Sleep 2s
