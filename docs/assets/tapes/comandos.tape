# Comandos con flags: vista previa y emision con salida JSON. Se graba con scripts/demo/record.sh.
Output docs/assets/demo/comandos.gif

Require node
Require jq
Set Shell "bash"
Set FontSize 15
Set Width 1100
Set Height 780
Set Padding 20
Set Theme "TokyoNight"
Set WindowBar Colorful
Set TypingSpeed 45ms

Hide
Type "source scripts/demo/setup.sh" Enter
Sleep 500ms
Show

Type "arcli fc -m 15000 --cs --cfinal --ir-cf --previsualizar" Sleep 500ms Enter
Sleep 4s
Type "clear" Enter
Type "arcli fc -m 15000 --cs --cfinal --ir-cf --emitir --json | jq '{estado, cae, caeVencimiento}'" Sleep 500ms Enter
Sleep 6s
