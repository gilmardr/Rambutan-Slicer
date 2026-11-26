; NSIS installer hooks for the 32-bit (x86) Windows build.
; Selected by src-tauri/tauri.windows-x86.conf.json.
;
; Same as thumbnail-hooks.nsh without the Visual C++ prerequisite: the x86
; executable links the C runtime statically, so there is nothing to install.
; On 64-bit Windows the 32-bit thumbnail DLL registers in the 32-bit view and
; 64-bit Explorer ignores it; on 32-bit Windows it gives .voxl thumbnails.

!macro NSIS_HOOK_PREINSTALL
  !if "${ARCH}" != "x86"
    !error "thumbnail-hooks-x86.nsh is for the x86 package only; x64 uses thumbnail-hooks.nsh."
  !endif
!macroend

!macro customInstall
  SetCtlColors $HWNDPARENT 0x16161E 0xE8E8F0
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$SYSDIR\regsvr32.exe" /s "$INSTDIR\resources\dragonfruit_voxl_thumbnail_com.dll"'
  System::Call 'shell32::SHChangeNotify(i 0x8000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$SYSDIR\regsvr32.exe" /s /u "$INSTDIR\resources\dragonfruit_voxl_thumbnail_com.dll"'
!macroend
