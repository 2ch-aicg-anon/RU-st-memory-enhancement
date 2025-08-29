import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { updateSystemMessageTableStatus } from "../renderer/tablePushToChat.js";
import { findNextChatWhitTableData, undoSheets } from "../../index.js";
import { rebuildSheets } from "../runtime/absoluteRefresh.js";
import { openTableHistoryPopup } from "./tableHistory.js";
import { PopupMenu } from "../../components/popupMenu.js";
import { openTableStatisticsPopup } from "./tableStatistics.js";
import { openCellHistoryPopup } from "./cellHistory.js";
import { openSheetStyleRendererPopup } from "./sheetStyleEditor.js";
import { Cell } from "../../core/table/cell.js";

let tablePopup = null
let copyTableData = null
let selectedCell = null
let editModeSelectedRows = []
let viewSheetsContainer = null
const userTableEditInfo = {
    chatIndex: null,
    editAble: false,
    tables: null,
    tableIndex: null,
    rowIndex: null,
    colIndex: null,
}

/**
 * Copy tables
 * @param {*} tables all table data
 */
export async function copyTable() {
    copyTableData = JSON.stringify(getTableJson({ type: 'chatSheets', version: 1 }))
    if (!copyTableData) return
    $('#table_drawer_icon').click()

    EDITOR.confirm(`Копирование данных таблицы (#${SYSTEM.generateRandomString(4)})`, 'Отмена', 'Вставить в текущий диалог').then(async (r) => {
        if (r) {
            await pasteTable()
        }
        if ($('#table_drawer_icon').hasClass('closedIcon')) {
            $('#table_drawer_icon').click()
        }
    })
}

/**
 * Paste table
 * @param {number} mesId message id to paste into
 * @param {Element} viewSheetsContainer table container DOM
 */
async function pasteTable() {
    if (USER.getContext().chat.length === 0) {
        EDITOR.error("Нет носителя для записи; таблицы сохраняются в истории чата. Пожалуйста, отправьте хотя бы одно сообщение и попробуйте снова")
        return
    }
    const confirmation = await EDITOR.callGenericPopup('Вставка очистит существующие данные таблицы. Продолжить?', EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Продолжить", cancelButton: "Отмена" });
    if (confirmation) {
        if (copyTableData) {
            const tables = JSON.parse(copyTableData)
            if (!tables.mate === 'chatSheets') return EDITOR.error("Импорт не удался: неверный формат файла")
            BASE.applyJsonToChatSheets(tables)
            await renderSheetsDOM()
            EDITOR.success('Вставка выполнена')
        } else {
            EDITOR.error("Вставка не удалась: в буфере обмена нет данных таблицы")
        }
    }
}

/**
 * Import table
 * @param {number} mesId message id to import into
 */
async function importTable(mesId, viewSheetsContainer) {
    if (mesId === -1) {
        EDITOR.error("Нет носителя для записи; таблицы сохраняются в истории чата. Пожалуйста, отправьте хотя бы одно сообщение и попробуйте снова")
        return
    }

    // 1. 创建一个 input 元素，类型设置为 'file'，用于文件选择
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    // 设置 accept 属性，限制只能选择 JSON 文件，提高用户体验
    fileInput.accept = '.json';

    // 2. 添加事件监听器，监听文件选择的变化 (change 事件)
    fileInput.addEventListener('change', function (event) {
        // 获取用户选择的文件列表 (FileList 对象)
        const files = event.target.files;

        // 检查是否选择了文件
        if (files && files.length > 0) {
            // 获取用户选择的第一个文件 (这里假设只选择一个 JSON 文件)
            const file = files[0];

            // 3. 创建 FileReader 对象，用于读取文件内容
            const reader = new FileReader();

            // 4. 定义 FileReader 的 onload 事件处理函数
            // 当文件读取成功后，会触发 onload 事件
            reader.onload = async function (loadEvent) {
                const button = { text: 'Импортировать шаблон и данные', result: 3 }
                const popup = new EDITOR.Popup("Выберите, что импортировать", EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Импортировать шаблон и данные", cancelButton: "Отмена" });
                const result = await popup.show()
                if (result) {
                    const tables = JSON.parse(loadEvent.target.result)
                    console.log("Импортируемое содержимое", tables, tables.mate, !(tables.mate === 'chatSheets'))
                    if (!(tables.mate?.type === 'chatSheets')) return EDITOR.error("Импорт не удался: неверный формат файла", "Проверьте, что импортируете данные таблицы")
                    if (result === 3)
                        BASE.applyJsonToChatSheets(tables, "data")
                    else
                        BASE.applyJsonToChatSheets(tables)
                    await renderSheetsDOM()
                    EDITOR.success('Импорт выполнен')
                }
            };
            reader.readAsText(file, 'UTF-8'); // 建议指定 UTF-8 编码，确保中文等字符正常读取
        }
    });
    fileInput.click();
}

/**
 * 导出表格
 * @param {Array} tables 所有表格数据
 */
async function exportTable() {
    const jsonTables = getTableJson({ type: 'chatSheets', version: 1 })
    if (!jsonTables) return
    const bom = '\uFEFF';
    const blob = new Blob([bom + JSON.stringify(jsonTables)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const downloadLink = document.createElement('a');
    downloadLink.href = url;
    downloadLink.download = 'table_data.json'; // 默认文件名
    document.body.appendChild(downloadLink); // 必须添加到 DOM 才能触发下载
    downloadLink.click();
    document.body.removeChild(downloadLink); // 下载完成后移除

    URL.revokeObjectURL(url); // 释放 URL 对象

    EDITOR.success('Экспорт выполнен');
}

/**
 * 获取表格Json数据
 */
function getTableJson(mate) {
    if (!DERIVED.any.renderingSheets || DERIVED.any.renderingSheets.length === 0) {
        EDITOR.warning('Текущая таблица пуста, экспорт невозможен');
        return;
    }
    const sheets = DERIVED.any.renderingSheets.filter(sheet => sheet.enable)
    // const csvTables = sheets.map(sheet => "SHEET-START" + sheet.uid + "\n" + sheet.getSheetCSV(false) + "SHEET-END").join('\n')
    const jsonTables = {}
    sheets.forEach(sheet => {
        jsonTables[sheet.uid] = sheet.getJson()
    })
    jsonTables.mate = mate
    return jsonTables
}

/**
 * 清空表格
 * @param {number} mesId 需要清空表格的消息id
 * @param {Element} viewSheetsContainer 表格容器DOM
 */
async function clearTable(mesId, viewSheetsContainer) {
    if (mesId === -1) return
    const confirmation = await EDITOR.callGenericPopup('Очистить все данные таблиц в текущем диалоге и сбросить историю? Операция необратима.', EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Продолжить", cancelButton: "Отмена" });
    if (confirmation) {
        await USER.getContext().chat.forEach((piece => {
            if (piece.hash_sheets) {
                delete piece.hash_sheets
            }
            if (piece.dataTable) delete piece.dataTable
        }))
        setTimeout(() => {
            USER.saveSettings()
            USER.saveChat();
            refreshContextView()
            EDITOR.success("Данные таблицы успешно очищены")
            console.log("Табличные данные очищены")
        }, 100)
    }
}

/**
 * 设置表格编辑Tips
 * @param {Element} tableEditTips 表格编辑提示DOM
 */
function setTableEditTips(tableEditTips) {
    /* if (!tableEditTips || tableEditTips.length === 0) {
        console.error('tableEditTips is null or empty jQuery object');
        return;
    }
    const tips = $(tableEditTips); // 确保 tableEditTips 是 jQuery 对象
    tips.empty();
    if (USER.tableBaseSetting.isExtensionAble === false) {
        tips.append('Плагин отключён, AI не будет обновлять таблицу.');
        tips.css("color", "rgb(211 39 39)");
    } else if (userTableEditInfo.editAble) {
        tips.append('Нажмите на ячейку, чтобы выбрать действие. Зеленые ячейки — вставка, синие — изменение.');
        tips.css("color", "lightgreen");
    } else {
        tips.append('Это промежуточная таблица; чтобы избежать путаницы, её нельзя редактировать или вставлять. Откройте таблицу последнего сообщения для редактирования');
        tips.css("color", "lightyellow");
    } */
}

async function cellDataEdit(cell) {
    const result = await EDITOR.callGenericPopup("Редактировать ячейку", EDITOR.POPUP_TYPE.INPUT, cell.data.value, { rows: 3 })
    if (result) {
        cell.editCellData({ value: result })
        refreshContextView();
        if (cell.type === Cell.CellType.column_header) BASE.refreshTempView(true)
    }
}


async function columnDataEdit(cell) {
    const columnEditor = `
<div class="column-editor">
    <div class="column-editor-header">
        <h3>Редактирование столбца</h3>
    </div>
    <div class="column-editor-body">
        <div class="column-editor-content">
            <label for="column-editor-input">Данные столбца:</label>
            <textarea id="column-editor-input" rows="5"></textarea>
        </div>
    </div>
</div>
`
    const columnCellDataPopup = new EDITOR.Popup(columnEditor, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Применить изменения", cancelButton: "Отмена" });
    const historyContainer = $(columnCellDataPopup.dlg)[0];

    await columnCellDataPopup.show();

    if (columnCellDataPopup.result) {
        // cell.editCellData({ value: result })
        refreshContextView();
    }
}

function batchEditMode(cell) {
    DERIVED.any.batchEditMode = true;
    DERIVED.any.batchEditModeSheet = cell.parent;
    EDITOR.confirm(`Редактирование строки #${cell.parent.name}`, 'Отмена', 'Готово').then((r) => {
        DERIVED.any.batchEditMode = false;
        DERIVED.any.batchEditModeSheet = null;
        renderSheetsDOM();
    })
    renderSheetsDOM();
}

// 新的事件处理函数
export function cellClickEditModeEvent(cell) {
    cell.element.style.cursor = 'pointer'
    if (cell.type === Cell.CellType.row_header) {
        cell.element.textContent = ''

        // 在 cell.element 中添加三个 div，一个用于显示排序，一个用于显示锁定按钮，一个用于显示删除按钮
        const containerDiv = $(`<div class="flex-container" style="display: flex; flex-direction: row; justify-content: space-between; width: 100%;"></div>`)
        const rightDiv = $(`<div class="flex-container" style="margin-right: 3px"></div>`)
        const indexDiv = $(`<span class="menu_button_icon interactable" style="margin: 0; padding: 0 6px; cursor: move; color: var(--SmartThemeBodyColor)">${cell.position[0]}</span>`)
        const lockDiv = $(`<div><i class="menu_button menu_button_icon interactable fa fa-lock" style="margin: 0; border: none; color: var(--SmartThemeEmColor)"></i></div>`)
        const deleteDiv = $(`<div><i class="menu_button menu_button_icon interactable fa fa-xmark redWarningBG" style="margin: 0; border: none; color: var(--SmartThemeEmColor)"></i></div>`)

        $(lockDiv).on('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (cell._pre_deletion) return

            cell.parent.hashSheet.forEach(row => {
                if (row[0] === cell.uid) {
                    row.forEach((hash) => {
                        const target = cell.parent.cells.get(hash)
                        target.locked = !target.locked
                        target.element.style.backgroundColor = target.locked ? '#00ff0022' : ''
                    })
                }
            })
        })
        $(deleteDiv).on('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            handleAction(cell, Cell.CellAction.deleteSelfRow)
            //if (cell.locked) return

            /* cell.parent.hashSheet.forEach(row => {
                if (row[0] === cell.uid) {
                    row.forEach((hash) => {
                        const target = cell.parent.cells.get(hash)
                        target._pre_deletion = !target._pre_deletion
                        target.element.style.backgroundColor = target._pre_deletion ? '#ff000044' : ''
                    })
                }
            }) */
        })

        $(rightDiv).append(deleteDiv)
        $(containerDiv).append(indexDiv).append(rightDiv)
        $(cell.element).append(containerDiv)

    } else if (cell.type === Cell.CellType.cell) {
        cell.element.style.cursor = 'text'
        cell.element.contentEditable = true
        cell.element.focus()
        cell.element.addEventListener('blur', (e) => {
            e.stopPropagation();
            e.preventDefault();
            cell.data.value = cell.element.textContent.trim()
        })
    }

    cell.on('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();
    })
}

async function confirmAction(event, text = 'Продолжить действие?') {
    const confirmation = new EDITOR.Popup(text, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Продолжить", cancelButton: "Отмена" });

    await confirmation.show();
    if (!confirmation.result) return { filterData: null, confirmation: false };
    event()
}

async function cellHistoryView(cell) {
    await openCellHistoryPopup(cell)
}

/**
 * 自定义表格样式事件
 * @param {*} cell
 */
async function customSheetStyle(cell) {
    await openSheetStyleRendererPopup(cell.parent)
    await refreshContextView();
}

function cellClickEvent(cell) {
    cell.element.style.cursor = 'pointer'

    cell.on('click', async (event) => {
        event.stopPropagation();
        event.preventDefault();

        // 重新获取hash
        BASE.getLastestSheets()

        if (cell.parent.currentPopupMenu) {
            cell.parent.currentPopupMenu.destroy();
            cell.parent.currentPopupMenu = null;
        }
        cell.parent.currentPopupMenu = new PopupMenu();

        const menu = cell.parent.currentPopupMenu;
        const [rowIndex, colIndex] = cell.position;
        const sheetType = cell.parent.type;

        if (rowIndex === 0 && colIndex === 0) {
            menu.add('<i class="fa-solid fa-bars-staggered"></i> Пакетное редактирование строк', () => batchEditMode(cell));
            menu.add('<i class="fa fa-arrow-right"></i> Вставить столбец справа', () => handleAction(cell, Cell.CellAction.insertRightColumn));
            menu.add('<i class="fa fa-arrow-down"></i> Вставить строку снизу', () => handleAction(cell, Cell.CellAction.insertDownRow));
            menu.add('<i class="fa-solid fa-wand-magic-sparkles"></i> Настроить стиль таблицы', async () => customSheetStyle(cell));
        } else if (colIndex === 0) {
            menu.add('<i class="fa-solid fa-bars-staggered"></i> Пакетное редактирование строк', () => batchEditMode(cell));
            menu.add('<i class="fa fa-arrow-up"></i> Вставить строку сверху', () => handleAction(cell, Cell.CellAction.insertUpRow));
            menu.add('<i class="fa fa-arrow-down"></i> Вставить строку снизу', () => handleAction(cell, Cell.CellAction.insertDownRow));
            menu.add('<i class="fa fa-trash-alt"></i> Удалить строку', () => handleAction(cell, Cell.CellAction.deleteSelfRow), menu.ItemType.warning)
        } else if (rowIndex === 0) {
            menu.add('<i class="fa fa-i-cursor"></i> Редактировать столбец', async () => await cellDataEdit(cell));
            menu.add('<i class="fa fa-arrow-left"></i> Вставить столбец слева', () => handleAction(cell, Cell.CellAction.insertLeftColumn));
            menu.add('<i class="fa fa-arrow-right"></i> Вставить столбец справа', () => handleAction(cell, Cell.CellAction.insertRightColumn));
            menu.add('<i class="fa fa-trash-alt"></i> Удалить столбец', () => confirmAction(() => { handleAction(cell, Cell.CellAction.deleteSelfColumn) }, 'Подтвердить удаление столбца?'), menu.ItemType.warning);
        } else {
            menu.add('<i class="fa fa-i-cursor"></i> Редактировать ячейку', async () => await cellDataEdit(cell));
            menu.add('<i class="fa-solid fa-clock-rotate-left"></i> История ячейки', async () => await cellHistoryView(cell));
        }

        // 设置弹出菜单后的一些非功能性派生操作，这里必须使用setTimeout，否则会导致菜单无法正常显示
        setTimeout(() => {

        }, 0)

        const element = event.target

        // 备份当前cell的style，以便在菜单关闭时恢复
        const style = element.style.cssText;

        // 获取单元格位置
        const rect = element.getBoundingClientRect();
        const tableRect = viewSheetsContainer.getBoundingClientRect();

        // 计算菜单位置（相对于表格容器）
        const menuLeft = rect.left - tableRect.left;
        const menuTop = rect.bottom - tableRect.top;
        const menuElement = menu.renderMenu();
        $(viewSheetsContainer).append(menuElement);

        // 高亮cell
        element.style.backgroundColor = 'var(--SmartThemeUserMesBlurTintColor)';
        element.style.color = 'var(--SmartThemeQuoteColor)';
        element.style.outline = '1px solid var(--SmartThemeQuoteColor)';
        element.style.zIndex = '999';

        menu.show(menuLeft, menuTop).then(() => {
            element.style.cssText = style;
        })
        menu.frameUpdate((menu) => {
            // 重新定位菜单
            const rect = element.getBoundingClientRect();
            const tableRect = viewSheetsContainer.getBoundingClientRect();

            // 计算菜单位置（相对于表格容器）
            const menuLeft = rect.left - tableRect.left;
            const menuTop = rect.bottom - tableRect.top;
            menu.popupContainer.style.left = `${menuLeft}px`;
            menu.popupContainer.style.top = `${menuTop + 3}px`;
        })
    })
    cell.on('', () => {
        console.log('Ячейка изменена:', cell)
    })
}

function handleAction(cell, action) {
    cell.newAction(action)
    refreshContextView();
    if (cell.type === Cell.CellType.column_header) BASE.refreshTempView(true)
}

export async function renderEditableSheetsDOM(_sheets, _viewSheetsContainer, _cellClickEvent = cellClickEvent) {
    for (let [index, sheet] of _sheets.entries()) {
        if (!sheet.enable) continue
        const instance = sheet
        console.log("Рендер:", instance)
        const sheetContainer = document.createElement('div')
        const sheetTitleText = document.createElement('h3')
        sheetContainer.style.overflowX = 'none'
        sheetContainer.style.overflowY = 'auto'
        sheetTitleText.innerText = `#${index} ${sheet.name}`

        let sheetElement = null

        if (DERIVED.any.batchEditMode === true) {
            if (DERIVED.any.batchEditModeSheet?.name === instance.name) {
                sheetElement = await instance.renderSheet(cellClickEditModeEvent)
            } else {
                sheetElement = await instance.renderSheet((cell) => {
                    cell.element.style.cursor = 'default'
                })
                sheetElement.style.cursor = 'default'
                sheetElement.style.opacity = '0.5'
                sheetTitleText.style.opacity = '0.5'
            }
        } else {
            sheetElement = await instance.renderSheet(_cellClickEvent)
        }
        // 已集成到 Sheet.renderSheet 内部，这里无需再次调用
        console.log("Рендер таблицы:", sheetElement)
        $(sheetContainer).append(sheetElement)

        $(_viewSheetsContainer).append(sheetTitleText)
        $(_viewSheetsContainer).append(sheetContainer)
        $(_viewSheetsContainer).append(`<hr>`)
    }
}

/**
 * 恢复表格
 * @param {number} mesId 需要清空表格的消息id
 * @param {Element} tableContainer 表格容器DOM
 */
async function undoTable(mesId, tableContainer) {
    if (mesId === -1) return
    //const button = { text: '撤销10轮', result: 3 }
    const popup = new EDITOR.Popup("Отменить все ручные правки и переработанные данные за выбранные раунды, восстановить таблицу", EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "Отменить текущий раунд", cancelButton: "Отмена" });
    const result = await popup.show()
    if (result) {
        await undoSheets(0)
        EDITOR.success('Откат выполнен')
    }
}


async function renderSheetsDOM(mesId = -1) {
    const task = new SYSTEM.taskTiming('renderSheetsDOM_task')
    DERIVED.any.renderingMesId = mesId
    updateSystemMessageTableStatus();
    task.log()
    const { deep: lastestDeep, piece: lastestPiece } = BASE.getLastSheetsPiece()
    const { piece, deep } = mesId === -1 ? { piece: lastestPiece, deep: lastestDeep } : { piece: USER.getContext().chat[mesId], deep: mesId }
    if (!piece || !piece.hash_sheets) return;

    if (deep === lastestDeep) DERIVED.any.isRenderLastest = true;
    else DERIVED.any.isRenderLastest = false;
    DERIVED.any.renderDeep = deep;

    const sheets = BASE.hashSheetsToSheets(piece.hash_sheets);
    sheets.forEach((sheet) => {
        sheet.hashSheet = sheet.hashSheet.filter((row) => {
            return (sheet.cells.get(row[0]).isDeleted !== true);
        })
        sheet.cells.forEach((cell) => {
            cell.isDeleted = false;
        })
    })
    console.log('renderSheetsDOM:', piece, sheets)
    DERIVED.any.renderingSheets = sheets

    task.log()
    $(viewSheetsContainer).empty()
    viewSheetsContainer.style.paddingBottom = '150px'
    renderEditableSheetsDOM(sheets, viewSheetsContainer, DERIVED.any.isRenderLastest ? undefined : () => { })
    $("#table_indicator").text(DERIVED.any.isRenderLastest ? "Сейчас активная таблица доступна для изменения" : `Отображается старая таблица из ${deep}-го раунда, изменение запрещено`)
    task.log()
}

let initializedTableView = null
async function initTableView(mesId) {
    initializedTableView = $(await SYSTEM.getTemplate('manager')).get(0);
    viewSheetsContainer = initializedTableView.querySelector('#tableContainer');
    // setTableEditTips($(initializedTableView).find('#tableEditTips'));    // 确保在 table_manager_container 存在的情况下查找 tableEditTips

    // 设置编辑提示
    // 点击打开查看表格数据统计
    $(document).on('click', '#table_data_statistics_button', function () {
        EDITOR.tryBlock(openTableStatisticsPopup, "Не удалось открыть статистику таблицы")
    })
    // 点击打开查看表格历史按钮
    $(document).on('click', '#dataTable_history_button', function () {
        EDITOR.tryBlock(openTableHistoryPopup, "Не удалось открыть историю таблицы")
    })
    // 点击清空表格按钮
    $(document).on('click', '#clear_table_button', function () {
        EDITOR.tryBlock(clearTable, "Не удалось очистить таблицу", userTableEditInfo.chatIndex, viewSheetsContainer);
    })
    $(document).on('click', '#table_rebuild_button', function () {
        EDITOR.tryBlock(rebuildSheets, "Не удалось перестроить таблицу");
    })
    // 点击编辑表格按钮
    $(document).on('click', '#table_edit_mode_button', function () {
        // openTableEditorPopup();
    })
    // 点击恢复表格按钮
    $(document).on('click', '#table_undo', function () {
        EDITOR.tryBlock(undoTable, "Не удалось восстановить таблицу");
    })
    // 点击复制表格按钮
    $(document).on('click', '#copy_table_button', function () {
        EDITOR.tryBlock(copyTable, "Не удалось копировать таблицу");
    })
    // 点击导入表格按钮
    $(document).on('click', '#import_table_button', function () {
        EDITOR.tryBlock(importTable, "Не удалось импортировать таблицу", userTableEditInfo.chatIndex, viewSheetsContainer);
    })
    // 点击导出表格按钮
    $(document).on('click', '#export_table_button', function () {
        EDITOR.tryBlock(exportTable, "Не удалось экспортировать таблицу");
    })
    // 点击前表按钮
    $(document).on('click', '#table_prev_button', function () {
        const deep = DERIVED.any.renderDeep;
        const { deep: prevDeep } = BASE.getLastSheetsPiece(deep - 1, 20, false);
        if (prevDeep === -1) {
            EDITOR.error("Больше нет данных таблицы")
            return
        }
        renderSheetsDOM(prevDeep);
    })

    // 点击后表按钮
    $(document).on('click', '#table_next_button', function () {
        const deep = DERIVED.any.renderDeep;
        console.log("Текущая глубина:", deep)
        const { deep: nextDeep } = BASE.getLastSheetsPiece(deep + 1, 20, false, "down");
        if (nextDeep === -1) {
            EDITOR.error("Больше нет данных таблицы")
            return
        }
        renderSheetsDOM(nextDeep);
    })

    return initializedTableView;
}

export async function refreshContextView(mesId = -1) {
    if (BASE.contextViewRefreshing) return
    BASE.contextViewRefreshing = true
    await renderSheetsDOM(mesId);
    console.log("Обновление представления таблицы")
    BASE.contextViewRefreshing = false
}

export async function getChatSheetsView(mesId = -1) {
    // 如果已经初始化过，直接返回缓存的容器，避免重复创建
    if (initializedTableView) {
        // 更新表格内容，但不重新创建整个容器
        await renderSheetsDOM();
        return initializedTableView;
    }
    return await initTableView(mesId);
}
