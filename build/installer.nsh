# Custom "Shortcuts" page for the assisted (NSIS) installer.
#
# electron-builder's createDesktopShortcut is all-or-nothing, so the checkbox
# rides the supported customPageAfterChangeDir hook and customInstall removes
# the shortcut electron-builder already wrote when the box is cleared.
# Silent and update runs never show the page, so customInit seeds the default
# (checked) and customInstall leaves those runs alone.
#
# The page and its functions are installer-only: the same script is compiled a
# second time with BUILD_UNINSTALLER, where the hook is not inserted and the
# functions would be flagged as unreferenced (warnings are errors here).

!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

!macro customInit
  StrCpy $AKUDesktopShortcut ${BST_CHECKED}
!macroend

!ifndef BUILD_UNINSTALLER
  Var AKUDesktopShortcut

  !macro customPageAfterChangeDir
    Page custom AKUShortcutPageCreate AKUShortcutPageLeave
  !macroend

  Function AKUShortcutPageCreate
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 24u "AKU can add a shortcut to your desktop.$\r$\nYou can change this later by creating a shortcut yourself."
    Pop $0
    ${NSD_CreateCheckbox} 0 32u 100% 12u "Create a desktop shortcut"
    Pop $AKUDesktopShortcut
    ${NSD_Check} $AKUDesktopShortcut
    nsDialogs::Show
  FunctionEnd

  Function AKUShortcutPageLeave
    ${NSD_GetState} $AKUDesktopShortcut $0
    StrCpy $AKUDesktopShortcut $0
  FunctionEnd
!endif

!macro customInstall
  ${IfNot} ${Silent}
    ${IfNot} ${isUpdated}
      ${If} $AKUDesktopShortcut != ${BST_CHECKED}
        Delete "$newDesktopLink"
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend
