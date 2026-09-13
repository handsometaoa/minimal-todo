; 极简待办自定义安装向导扩展（electron-builder NSIS 模板钩子）
; 本文件在模板展开之前编译，因此可以重定义模板编译期常量、预先定义 MUI 完成页参数。
;
; 功能：
; - 安装目录：自定义目录选择页，全新安装默认文件夹为 MinimalTodo（首字母大写），
;   地址栏直接显示最终安装路径；升级安装保留注册表里的原路径。
;   模板的 MUI_PAGE_DIRECTORY + instFilesPre 清洗按 APP_FILENAME 追加子文件夹，
;   改默认名会拼出 MinimalTodo\minimal-todo-desktop 这类错误路径，
;   因此 undef 掉 allowToChangeInstallationDirectory、整页自行实现
; - 完成页勾选框换位：「开机自动启动」在「运行」上方，两项默认勾选。
;   MUI2 完成页 RUN 勾选框在上、SHOWREADME 在下，故自启动映射到 RUN 槽位；
;   定义 HIDE_RUN_AFTER_FINISH 让模板不注入它自己的 MUI_FINISHPAGE_RUN（StartApp）。
;   Run 键的值名/数据与 electron/main.cjs setLoginItemSettings 完全一致：
;     值名 = AppUserModelID（main.cjs 中 app.setAppUserModelId 写死的 id）
;     数据 = 无引号的 exe 完整路径
;   （getter 按值名 AUMID 精确匹配无引号路径，格式不一致应用内开关就读不到安装器写入的状态）
; - customUnWelcomePage：卸载页提供「清除个人数据」勾选（默认不勾，保留数据），
;   customUnInstall 按勾选状态清理 userData
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

!define HK_AUTOLAUNCH_NAME "com.handsometaoa.minimal-todo"
!define HK_RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
; 与 multiUser.nsh 的 /ifndef 定义保持一致；本文件的函数需要引用它
!define INSTALL_REGISTRY_KEY "Software\${APP_GUID}"

!ifndef BUILD_UNINSTALLER
  ; —— 安装目录：自定义目录选择页，全新安装默认文件夹为 MinimalTodo ——
  ; 模板 MUI_PAGE_DIRECTORY + instFilesPre 会按 ${APP_FILENAME}（minimal-todo-desktop）
  ; 给不含该名字的路径追加子文件夹：全新安装改名 MinimalTodo 后会被二次拼接成
  ; MinimalTodo\minimal-todo-desktop，升级旧路径也会被追加。因此 undef 掉
  ; allowToChangeInstallationDirectory 禁用模板目录页与清洗，自己实现目录页。
  !undef allowToChangeInstallationDirectory
  !include "StrContains.nsh"

  Var hkDirField

!macro customPageAfterChangeDir
    Page custom hkDirPageCreate hkDirPageLeave
  !macroend

  Function hkDirPageCreate
    GetDlgItem $0 $HWNDPARENT 1037
    SendMessage $0 ${WM_SETTEXT} 0 "STR:选定安装位置"
    GetDlgItem $0 $HWNDPARENT 1038
    SendMessage $0 ${WM_SETTEXT} 0 "STR:选定 ${PRODUCT_NAME} 要安装的文件夹。"

    nsDialogs::Create 1018
    Pop $0

    ${NSD_CreateLabel} 0 0u 100% 16u "目标文件夹"
    Pop $1

    ; $INSTDIR 已由安装模式页设好（升级=注册表原路径；全新=…\Programs\minimal-todo-desktop）
    Call hkFreshInstallDir

    ${NSD_CreateText} 0 18u 100% 14u "$INSTDIR"
    Pop $hkDirField

    ${NSD_CreateBrowseButton} 0 38u 70u 14u "浏览(B)..."
    Pop $1
    ${NSD_OnClick} $1 hkDirBrowseClick

    nsDialogs::Show
  FunctionEnd

  Function hkDirBrowseClick
    ${NSD_GetText} $hkDirField $1
    nsDialogs::SelectFolderDialog "选定 ${PRODUCT_NAME} 要安装的文件夹" "$1"
    Pop $0
    ${If} $0 != "error"
      StrCpy $INSTDIR $0
      Call hkFreshInstallDir
      ${If} $0 == "1"
        Call hkAppendSubfolder
      ${EndIf}
      ${NSD_SetText} $hkDirField $INSTDIR
    ${EndIf}
  FunctionEnd

  Function hkDirPageLeave
    ${NSD_GetText} $hkDirField $INSTDIR
    Call hkFreshInstallDir
    ${If} $0 == "1"
      Call hkAppendSubfolder
    ${EndIf}
  FunctionEnd

  ; 全新安装补全最终路径：用户选了上级目录（如 D:\）时追加 MinimalTodo
  ; （路径中已含 MinimalTodo 则不重复追加）
  Function hkAppendSubfolder
    Push $INSTDIR
    Push "MinimalTodo"
    Call StrContains
    Pop $1
    ${If} $1 == ""
      StrCpy $2 $INSTDIR 1 -1
      ${If} $2 == "\"
        StrCpy $INSTDIR "$INSTDIRMinimalTodo"
      ${Else}
        StrCpy $INSTDIR "$INSTDIR\MinimalTodo"
      ${EndIf}
    ${EndIf}
  FunctionEnd

  ; 全新安装（HKCU/HKLM 均无 InstallLocation）时把默认目录末段的
  ; minimal-todo-desktop 换成 MinimalTodo，$0 返回 "1"；升级安装返回 "0" 且不改 $INSTDIR
  Function hkFreshInstallDir
    StrCpy $0 "0"
    ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $1 == ""
      ReadRegStr $1 HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${EndIf}
    ${If} $1 == ""
      StrLen $1 "${APP_FILENAME}"
      StrCpy $2 $INSTDIR "" -$1
      ${If} $2 == "${APP_FILENAME}"
        StrCpy $INSTDIR $INSTDIR -$1
        StrCpy $INSTDIR "$INSTDIR\MinimalTodo"
      ${EndIf}
      StrCpy $0 "1"
    ${EndIf}
  FunctionEnd

  ; —— 完成页：MUI2 的 RUN 勾选框在上、SHOWREADME 在下，按此映射 ——
  ; （MUI_PAGE_CUSTOMFUNCTION_LEAVE 已用于目录页，完成页不再挂离开回调；
  ;   自启动未勾选时的旧 Run 键清理由下方 customInstall 宏负责）
  !define HIDE_RUN_AFTER_FINISH
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_VARIABLES
  Var mui.FinishPage.Run
  !define MUI_FINISHPAGE_RUN_TEXT "开机自动启动 ${PRODUCT_NAME}"
  !define MUI_FINISHPAGE_RUN_FUNCTION "hkFinishSetAutoLaunch"
  !define MUI_FINISHPAGE_SHOWREADME
  !define MUI_FINISHPAGE_SHOWREADME_TEXT "运行 ${PRODUCT_NAME}"
  !define MUI_FINISHPAGE_SHOWREADME_FUNCTION "hkFinishRunApp"

  Function hkFinishSetAutoLaunch
    WriteRegStr HKCU "${HK_RUN_KEY}" "${HK_AUTOLAUNCH_NAME}" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  FunctionEnd

  Function hkFinishRunApp
    ; 模板 StartApp 依赖 StdUtils 插件目录与 $launchLink，均在本文件编译之后才可用；
    ; 本应用为按用户安装（RequestExecutionLevel user），直接 Exec 即为普通用户身份
    Exec "$INSTDIR\${PRODUCT_FILENAME}.exe"
  FunctionEnd
!endif

; —— 安装段：Run 键以完成页勾选为唯一事实来源 ——
; 非静默安装时先清掉旧 Run 键，完成页勾选自启动时由 hkFinishSetAutoLaunch 重写；
; 静默安装（/S，如自动升级）不弹完成页，完全不动用户现有的自启动设置
!macro customInstall
  IfSilent +2 0
  DeleteRegValue HKCU "${HK_RUN_KEY}" "${HK_AUTOLAUNCH_NAME}"
!macroend

; —— 卸载页：可选清除个人数据（默认保留）——
; 卸载器由 BUILD_UNINSTALLER 变体单独构建（主安装器仅嵌入签名后的卸载器 exe，
; 自身不含任何 un. 代码，否则触发 NSIS 6020 警告并被 -WX 视为错误）
!ifdef BUILD_UNINSTALLER
Var hkUnDeleteDataCheckbox
Var hkUnDeleteDataState
Var hkHeadingFont

!macro customUnWelcomePage
  UninstPage custom un.hkUnDataPageCreate un.hkUnDataPageLeave
!macroend

Function un.hkUnDataPageCreate
  GetDlgItem $0 $HWNDPARENT 1037
  SendMessage $0 ${WM_SETTEXT} 0 "STR:卸载 ${PRODUCT_NAME}"
  GetDlgItem $0 $HWNDPARENT 1038
  SendMessage $0 ${WM_SETTEXT} 0 "STR:选择卸载选项"

  nsDialogs::Create 1018
  Pop $0

  System::Call 'gdi32::CreateFontW(i -16, i 0, i 0, i 0, i 700, i 0, i 0, i 0, i 1, i 0, i 0, i 0, i 0, t "") i.s'
  Pop $hkHeadingFont

  ${NSD_CreateLabel} 0 0u 100% 20u "卸载 ${PRODUCT_NAME}"
  Pop $1
  SendMessage $1 ${WM_SETFONT} $hkHeadingFont 1

  ${NSD_CreateLabel} 0 28u 100% 26u "这将卸载 ${PRODUCT_NAME}。$\r$\n你的待办与设置保存在本机，卸载时可以选择是否一并删除。"
  Pop $1

  ${NSD_CreateCheckbox} 0 70u 100% 12u "同时清除个人数据（待办、设置等本地数据，不可恢复）"
  Pop $hkUnDeleteDataCheckbox
  StrCpy $hkUnDeleteDataState 0

  nsDialogs::Show
FunctionEnd

Function un.hkUnDataPageLeave
  ${NSD_GetState} $hkUnDeleteDataCheckbox $hkUnDeleteDataState
FunctionEnd

!macro customUnInstall
  ; 清理本应用与旧版本安装器写入的 Run 键
  DeleteRegValue HKCU "${HK_RUN_KEY}" "${HK_AUTOLAUNCH_NAME}"
  DeleteRegValue HKCU "${HK_RUN_KEY}" "${PRODUCT_FILENAME}"
  ; 勾选「清除个人数据」时删除本地数据（默认保留）：
  ; - $APPDATA\${PRODUCT_FILENAME}：Electron userData（含 app-data/minimal-todo.db 与旧版 storage）
  ; - $APPDATA\${APP_PACKAGE_NAME}：Electron 按 package.json name 写的缓存目录
  ${If} $hkUnDeleteDataState == 1
    RMDir /r "$APPDATA\${PRODUCT_FILENAME}"
    RMDir /r "$APPDATA\${APP_PACKAGE_NAME}"
  ${EndIf}
!macroend
!endif
