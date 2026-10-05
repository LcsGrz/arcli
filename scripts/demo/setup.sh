# Lo carga cada guion de VHS (oculto): usa la config de demo aislada y deja un prompt limpio.
export HOME="${ARCLI_DEMO_HOME:?Falta ARCLI_DEMO_HOME: correr con scripts/demo/record.sh}"
export NO_UPDATE_NOTIFIER=1
alias arcli="node ${ARCLI_REPO:?}/dist/cli/index.js"
PS1='\[\e[2m\]$\[\e[0m\] '
clear
