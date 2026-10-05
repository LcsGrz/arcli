# Modo interactivo: emitir una factura C en testing. Se graba con scripts/demo/record.sh.
Output docs/assets/demo/interactivo.gif

Require node
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 780
Set Padding 20
Set Theme "TokyoNight"
Set WindowBar Colorful
Set TypingSpeed 70ms

Hide
Type "source scripts/demo/setup.sh" Enter
Sleep 500ms
Show

Type "arcli" Sleep 600ms Enter
Sleep 2.5s
# Emitir factura
Enter
Sleep 1s
# Factura C
Enter
Sleep 1s
# Consumidor final
Enter
Sleep 1s
# Servicios
Enter
Sleep 1s
Type "150000" Sleep 600ms Enter
Sleep 1.2s
# Sin opcionales
Enter
Sleep 4s
# Emitir ahora
Enter
Sleep 6s
# Salir
Down 7
Sleep 500ms
Enter
Sleep 2s
