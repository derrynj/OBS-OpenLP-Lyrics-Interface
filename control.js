const LEFT = 0, RIGHT = 1, CENTER = 2, TOP = 0, BOTTOM = 1;

var openlpChannel = new BroadcastChannel("obs_openlp_channel");
var currentLines = [];
var originalCurrentLines = [];
var lastDisplayedIndex = -1;

var autoResize = true;
var nextSlideLines = [];

var max_saved_lines = 5;
var pastLines = [];
var historyIndex = 0;

var hiding = false;
var crossfadeDuration = 500;
var fadeDuration = 900;

var autoSplitLongLines = true;
var maxCharacters = 60;
var minWords = 3;
var previewLineCount = 3;
var settingsReady = false;

var textFormatting = {
    "all": false,
    "bold": true,
    "italics": true,
    "underline": true,
    "colors": false,
    "superscript": true,
    "subscript": false,
    "paragraph": false
};

openlpChannel.onmessage = function (ev) {
    let data = JSON.parse(ev.data);
    let type = data.type;
    if (type === "init") {
        if (settingsReady) {
            sendStageSettings();
        }
    } else if (type === "displayMode") {
        updateDisplayMode(data.value);
    } else if (type === "lyrics") {
        originalCurrentLines = data.lines;
        nextSlideLines = data.nextLines || [];
        updateCurrentLines();

        if ($("#auto-update-checkbox").prop("checked")) {
            if ($("#display-all-checkbox").prop("checked") || !autoSplitLongLines) {
                if (!displayNext(currentLines.length)) {
                    updateNextPreview();
                }
            } else {
                if (!displayNext(1)) {
                    updateNextPreview();
                }
            }
        } else {
            updateNextPreview();
        }
    }
};

function sendStageSettings() {
    openlpChannel.postMessage(JSON.stringify({type: "hideOnBlank", value: $("#auto-hide-checkbox").prop("checked")}));
    openlpChannel.postMessage(JSON.stringify({type: "crossfadeDuration", value: crossfadeDuration}));
    openlpChannel.postMessage(JSON.stringify({type: "fadeDuration", value: fadeDuration}));
    openlpChannel.postMessage(JSON.stringify({type: "hide", value: hiding}));
    openlpChannel.postMessage(JSON.stringify({type: "resize", value: autoResize}));
    openlpChannel.postMessage(JSON.stringify({type: "lyricsFont", value: $("#lyrics-font-size-spinner").val()}));
    openlpChannel.postMessage(JSON.stringify({type: "titleFont", value: $("#title-font-size-spinner").val()}));
    openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    openlpChannel.postMessage(JSON.stringify({type: "maxWidth", value: $("#lyrics-max-width-spinner").val()}));
    openlpChannel.postMessage(JSON.stringify({type: "lyricsHeight", value: $("#lyrics-height-spinner").val()}));
    openlpChannel.postMessage(JSON.stringify({type: "imageFit", value: $("#image-fit-select").val()}));
    openlpChannel.postMessage(JSON.stringify({
        type: "titleVisibility",
        song: $("#title-visibility-song").prop("checked"),
        bible: $("#title-visibility-scripture").prop("checked")
    }));
    transmitLyricsLayout();
    transmitTitleLayout();
}

/* Split lines into smaller ones that are no longer than maxCharacters, but at least minWords long
 * If minWords results in more than maxCharacters on a given line, that line will have fewer than minWords
 * If a word is longer than maxCharacters, it will be on its own line */
function splitLines(text) {
    minWords = Math.max(1, minWords);

    if (text === undefined)
        return "";

    // Don't split in the middle of HTML tag definitions
    let characters = Array.from(text);
    let newText = '';
    let inTag = false;
    $.each(characters, function (idx, char) {
        if (char == ' ' && !inTag) {
            newText += '__SPACE__';
        } else {
            if (char == '<') {
                inTag = true;
            } else if (char == '>') {
                inTag = false;
            }
            newText += char;
        }
    });
    let words = newText.split('__SPACE__');

    let lines = Array();
    let lineWords = Array();
    // Length of the line, not including any tags
    let lineWordsLength = 0;

    // Create the lines of words within the character constraint
    for (let i = 0; i < words.length; i++) {
        let wordLength = words[i].replace(/<[^>]+>/g, '').length;

        // Add at least one word per line; otherwise no more words than allowed by maxCharacters
        if (lineWords.length > 1 && lineWordsLength + 1 + wordLength > maxCharacters) {
            lines.push(lineWords);
            lineWords = Array(words[i]);
            lineWordsLength = wordLength;
        } else {
            lineWords.push(words[i]);
            lineWordsLength += 1 + wordLength;
        }
    }
    lines.push(lineWords);

    // Work backwards to ensure we have enough words per line
    let shifted = true;
    for (i = lines.length - 1; i > 1 && shifted; i--) {
        let shifted = false;
        while (lines[i].length < minWords) {
            if (lines[i - 1].length == 0) {
                lines.splice(i - 1, 1);
                i--;
                if (i < 1)
                    break;
            }

            newWord = lines[i - 1][lines[i - 1].length - 1];

            if (lines[i].join(" ").replace(/<[^>]+>/g, '').length + newWord.replace(/<[^>]+>/g, '').length + 1 < maxCharacters) {
                lines[i].unshift(lines[i - 1].pop());
                shifted = true;
            } else {
                break;
            }
        }
    }


    let linesOfWords = Array();
    for (i = 0; i < lines.length; i++) {
        linesOfWords.push(lines[i].join(" "));
    }

    return linesOfWords.join("\n");
}

function displayNext(amount) {
    if (!currentLines.length || amount <= 0) {
        return false;
    }

    //send lines to stage
    let linesToDisplay = "";
    for (let i = lastDisplayedIndex + 1; i <= lastDisplayedIndex + amount && i < currentLines.length; i++) {
        linesToDisplay += currentLines[i] + "<br>";
    }
    if (linesToDisplay.length <= 0) {
        return false;
    }
    openlpChannel.postMessage(JSON.stringify({type: "lyrics", value: linesToDisplay}));

    lastDisplayedIndex += amount;
    updateNextPreview();

    //update previous lines
    for (let i = max_saved_lines - 1; i > 0; i--) {
        if (pastLines[i - 1] !== undefined) {
            pastLines[i] = pastLines[i - 1];
        }
    }
    pastLines[0] = linesToDisplay;
    historyIndex = 0;
    return true;
}

function displayPrevious(amount) {
    if (lastDisplayedIndex < 0 || amount <= 0) {
        return false;
    }

    lastDisplayedIndex = Math.max(-1, lastDisplayedIndex - amount);
    let linesToDisplay = currentLines.slice(0, lastDisplayedIndex + 1).join("<br>");
    if (linesToDisplay.length > 0) {
        linesToDisplay += "<br>";
    }
    openlpChannel.postMessage(JSON.stringify({type: "lyrics", value: linesToDisplay}));

    updateNextPreview();
    return true;
}

function updateNextPreview() {
    let nextLineIndex = currentLines.findIndex(function (line, index) {
        return index > lastDisplayedIndex && line.trim().length > 0;
    });
    let showNextLine = $("#auto-split-long-lines-checkbox").prop("checked")
            && nextLineIndex !== -1;
    let lines = showNextLine ? [currentLines[nextLineIndex]] : nextSlideLines;
    let labelKey = showNextLine ? "next-line-preview" : "next-slide-preview";
    $("#preview-label").attr("data-i18n", labelKey).text($.i18n(labelKey));
    $("#next-slide-text").html(lines.filter(Boolean).slice(0, previewLineCount).join("<br>"));
    updateCurrentPreview();
}

function updateCurrentPreview() {
    let preview = currentLines.map(function (line, index) {
        return index <= lastDisplayedIndex ? "<b>" + line + "</b>" : line;
    }).filter(Boolean).slice(0, previewLineCount).join("<br>");
    $("#slide-text").html(preview);
}

function updateNavigationLabels() {
    let splitEnabled = $("#auto-split-long-lines-checkbox").prop("checked");
    let previousKey = splitEnabled ? "previous-line" : "previous-slide";
    let nextKey = splitEnabled ? "next-line" : "next-slide";
    $("#previous-button").attr("data-i18n", previousKey).text($.i18n(previousKey));
    $("#next-button").attr("data-i18n", nextKey).text($.i18n(nextKey));
}

function displaySaved(index) {
    if (index < 0
            || index > max_saved_lines
            || pastLines[index] === undefined) {
        return;
    }
    openlpChannel.postMessage(JSON.stringify({type: "lyrics", value: pastLines[index]}));
    historyIndex = index;
    updateNextPreview();
}

function updateCurrentLines() {
    lastDisplayedIndex = -1;
    if (autoSplitLongLines) {
        currentLines = [];
        $.each(originalCurrentLines, function (idx, longLine) {
            currentLines = currentLines.concat(splitLines(longLine).split(/\n/g));
        });
    } else {
        currentLines = originalCurrentLines.slice();
    }
}

function updateButtonSize(opt) {
    if (opt === "Normal") {
        $("button").css({"padding-top": "4px", "padding-bottom": "4px"});
    } else if (opt === "Large") {
        $("button").css({"padding": "10px", "padding-bottom": "10px"});
    } else {
        $("button").css({"padding": "20px", "padding-bottom": "20px"});
    }
}

//called on start to load saved settings
function loadSettings() {
    let loadedTitleHAnchor = window.localStorage.getItem("titleHAnchor");
    if (loadedTitleHAnchor !== null) {
        $("#title-layout-h-anchor").val(loadedTitleHAnchor);
    }
    let loadedTitleHOffset = window.localStorage.getItem("titleHOffset");
    if (loadedTitleHOffset !== null) {
        $("#title-layout-h-offset").val(Number(loadedTitleHOffset));
    }
    let loadedTitleVAnchor = window.localStorage.getItem("titleVAnchor");
    if (loadedTitleVAnchor !== null) {
        $("#title-layout-v-anchor").val(loadedTitleVAnchor);
    }
    let loadedLyricsHAnchor = window.localStorage.getItem("lyricsHAnchor");
    if (loadedLyricsHAnchor !== null) {
        $("#lyrics-layout-h-anchor").val(loadedLyricsHAnchor);
    }
    let loadedLyricsHOffset = window.localStorage.getItem("lyricsHOffset");
    if (loadedLyricsHOffset !== null) {
        $("#lyrics-layout-h-offset").val(Number(loadedLyricsHOffset));
    }
    let loadedLyricsVAnchor = window.localStorage.getItem("lyricsVAnchor");
    if (loadedLyricsVAnchor !== null) {
        $("#lyrics-layout-v-anchor").val(loadedLyricsVAnchor);
    }
    let loadedLyricsVOffset = window.localStorage.getItem("lyricsVOffset");
    if (loadedLyricsVOffset !== null) {
        $("#lyrics-layout-v-offset").val(Number(loadedLyricsVOffset));
    }
    let loadedMaxWidth = window.localStorage.getItem("maxWidth");
    if (loadedMaxWidth !== null) {
        $("#lyrics-max-width-spinner").val(Number(loadedMaxWidth));
    }
    let loadedLyricsHeight = window.localStorage.getItem("lyricsHeight");
    if (loadedLyricsHeight !== null) {
        $("#lyrics-height-spinner").val(Number(loadedLyricsHeight));
    }
    let loadedImageFit = window.localStorage.getItem("imageFit");
    if (loadedImageFit !== null && ["contain", "cover", "fill"].includes(loadedImageFit)) {
        $("#image-fit-select").val(loadedImageFit);
    }
    let loadedAutoUpdate = window.localStorage.getItem("autoUpdate");
    if (loadedAutoUpdate !== null) {
        $("#auto-update-checkbox").prop("checked", loadedAutoUpdate === "true");
    }
    let loadedAutoHide = window.localStorage.getItem("autoHide");
    if (loadedAutoHide !== null) {
        $("#auto-hide-checkbox").prop("checked", loadedAutoHide === "true");
    }
    let loadedResize = window.localStorage.getItem("autoResize");
    if (loadedResize !== null) {
        $("#resize-checkbox").prop("checked", loadedResize === "true");
    }
    let loadedDisplayAll = window.localStorage.getItem("displayAll");
    if (loadedDisplayAll !== null) {
        $("#display-all-checkbox").prop("checked", loadedDisplayAll === "true");
    }
    let loadedControlFont = window.localStorage.getItem("controlFont");
    if (loadedControlFont !== null) {
        $("*").css({"font-size": loadedControlFont + "pt"});
        $("#control-font-size-spinner").val(Number(loadedControlFont));
    }
    let loadedPreviewLineCount = Number(window.localStorage.getItem("previewLineCount"));
    if (Number.isInteger(loadedPreviewLineCount) && loadedPreviewLineCount >= 1 && loadedPreviewLineCount <= 20) {
        previewLineCount = loadedPreviewLineCount;
        $("#preview-line-count-spinner").val(previewLineCount);
    }
    let loadedLyricsFont = window.localStorage.getItem("lyricsFont");
    if (loadedLyricsFont !== null) {
        $("#lyrics-font-size-spinner").val(Number(loadedLyricsFont));
    }
    let loadedTitleFont = window.localStorage.getItem("titleFont");
    if (loadedTitleFont !== null) {
        $("#title-font-size-spinner").val(Number(loadedTitleFont));
    }
    let loadedCrossfadeDuration = window.localStorage.getItem("crossfadeDuration");
    if (loadedCrossfadeDuration !== null) {
        crossfadeDuration = loadedCrossfadeDuration;
        $("#crossfade-duration-spinner").val(Number(crossfadeDuration));
    }
    let loadedAutoSplitLongLines = window.localStorage.getItem("autoSplitLongLines");
    if (loadedAutoSplitLongLines !== null) {
        autoSplitLongLines = loadedAutoSplitLongLines === "true";
        $("#auto-split-long-lines-checkbox").prop("checked", autoSplitLongLines);
        if (!autoSplitLongLines) {
            $("#split-max-characters").hide();
            $("#split-min-words").hide();
        }
    }
    let loadedMaxCharacters = window.localStorage.getItem("maxCharacters");
    if (loadedMaxCharacters !== null) {
        maxCharacters = loadedMaxCharacters;
        $("#split-max-characters-spinner").val(Number(loadedMaxCharacters));
    }
    let loadedMinWords = window.localStorage.getItem("minWords");
    if (loadedMinWords !== null) {
        minWords = loadedMinWords;
        $("#split-min-words-spinner").val(Number(loadedMinWords));
    }
    let loadedTextFormattingAll = window.localStorage.getItem("textFormattingAll");
    if (loadedTextFormattingAll !== null) {
        textFormatting['all'] = loadedTextFormattingAll === "true";
    }
    $("#text-formatting-all-checkbox").prop("checked", textFormatting['all']);
    if (textFormatting['all']) {
        $(".text-formatting-checkbox").attr("disabled", true);
        $(".text-formatting-checkbox ~ label").addClass('disabled');
    }
    let loadedTextFormattingBold = window.localStorage.getItem("textFormattingBold");
    if (loadedTextFormattingBold !== null) {
        textFormatting['bold'] = loadedTextFormattingBold === "true";
    }
    $("#text-formatting-bold-checkbox").prop("checked", textFormatting['bold']);
    let loadedTextFormattingItalics = window.localStorage.getItem("textFormattingItalics");
    if (loadedTextFormattingItalics !== null) {
        textFormatting['italics'] = loadedTextFormattingItalics === "true";
    }
    $("#text-formatting-italics-checkbox").prop("checked", textFormatting['italics']);
    let loadedTextFormattingUnderline = window.localStorage.getItem("textFormattingUnderline");
    if (loadedTextFormattingUnderline !== null) {
        textFormatting['underline'] = loadedTextFormattingUnderline === "true";
    }
    $("#text-formatting-underline-checkbox").prop("checked", textFormatting['underline']);
    let loadedTextFormattingColors = window.localStorage.getItem("textFormattingColors");
    if (loadedTextFormattingColors !== null) {
        textFormatting['colors'] = loadedTextFormattingColors === "true";
    }
    $("#text-formatting-colors-checkbox").prop("checked", textFormatting['colors']);
    let loadedTextFormattingSuperscript = window.localStorage.getItem("textFormattingSuperscript");
    if (loadedTextFormattingSuperscript !== null) {
        textFormatting['superscript'] = loadedTextFormattingSuperscript === "true";
    }
    $("#text-formatting-superscript-checkbox").prop("checked", textFormatting['superscript']);
    let loadedTextFormattingSubscript = window.localStorage.getItem("textFormattingSubscript");
    if (loadedTextFormattingSubscript !== null) {
        textFormatting['subscript'] = loadedTextFormattingSubscript === "true";
    }
    $("#text-formatting-subscript-checkbox").prop("checked", textFormatting['subscript']);
    let loadedTextFormattingParagraph = window.localStorage.getItem("textFormattingParagraph");
    if (loadedTextFormattingParagraph !== null) {
        textFormatting['paragraph'] = loadedTextFormattingParagraph === "true";
    }
    $("#text-formatting-paragraph-checkbox").prop("checked", textFormatting['paragraph']);
    let loadedFadeDuration = window.localStorage.getItem("fadeDuration");
    if (loadedFadeDuration !== null) {
        fadeDuration = loadedFadeDuration;
        $("#fade-duration-spinner").val(Number(fadeDuration));
    }
    let loadedButtonSize = window.localStorage.getItem("buttonSize");
    if (loadedButtonSize !== null) {
        updateButtonSize(loadedButtonSize);
        $("#button-height-select").val(loadedButtonSize);
    }
    let titleVisibleSong = window.localStorage.getItem("titleVisibleSong");
    if (titleVisibleSong !== null) {
        $("#title-visibility-song").prop("checked", titleVisibleSong === "true");
    }
    let titleVisibleScripture = window.localStorage.getItem("titleVisibleScripture");
    if (titleVisibleScripture !== null) {
        $("#title-visibility-scripture").prop("checked", titleVisibleScripture === "true");
    }
    $("legend[data-collapse]").each(function (i) {
        let id = $(this).attr("data-collapse");
        let content = $("#" + id);
        id = id.replace("/-/g", "_");
        let collapsed = window.localStorage.getItem("collapsed_" + id);
        if (collapsed !== null && collapsed === "true") {
            $(this).addClass("active-collapsible");
            content.css("display", "none");
        }
    });
}

function transmitTitleLayout() {
    let hAnchorValue = $("#title-layout-h-anchor").val();
    let hOffsetValue = $("#title-layout-h-offset").val();
    let vAnchorValue = $("#title-layout-v-anchor").val();
    let hAnchorInt = 0, vAnchorInt = 0;

    if (hAnchorValue === "Left") {
        hAnchorInt = LEFT;
    } else if (hAnchorValue === "Right") {
        hAnchorInt = RIGHT;
    } else {
        hAnchorInt = CENTER;
    }
    if (vAnchorValue === "Top") {
        vAnchorInt = TOP;
    } else {
        vAnchorInt = BOTTOM;
    }
    openlpChannel.postMessage(JSON.stringify({
        type: "titleLayout",
        hAnchor: hAnchorInt,
        hOffset: hOffsetValue,
        vAnchor: vAnchorInt
    }));
}

function transmitLyricsLayout() {
    let hAnchorValue = $("#lyrics-layout-h-anchor").val();
    let hOffsetValue = $("#lyrics-layout-h-offset").val();
    let vAnchorValue = $("#lyrics-layout-v-anchor").val();
    let vOffsetValue = $("#lyrics-layout-v-offset").val();
    let hAnchorInt = 0, vAnchorInt = 0;

    if (hAnchorValue === "Left") {
        hAnchorInt = LEFT;
    } else if (hAnchorValue === "Right") {
        hAnchorInt = RIGHT;
    } else {
        hAnchorInt = CENTER;
    }
    if (vAnchorValue === "Top") {
        vAnchorInt = TOP;
    } else if (vAnchorValue === "Bottom") {
        vAnchorInt = BOTTOM;
    } else {
        vAnchorInt = CENTER;
    }
    openlpChannel.postMessage(JSON.stringify({
        type: "lyricsLayout",
        hAnchor: hAnchorInt,
        hOffset: hOffsetValue,
        vAnchor: vAnchorInt,
        vOffset: vOffsetValue
    }));
}

function sendApiCommand(url, data) {
    $("#action-status").text("");
    $.ajax({
        url: url,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify(data)
    }).fail(function (xhr) {
        showApiError(xhr);
    });
}

function showApiError(xhr) {
    let message = xhr.status === 401
            ? $.i18n("api-authentication-required")
            : $.i18n("command-failed") + " (HTTP " + (xhr.status || "?") + ")";
    $("#action-status").text(message);
}

function updateDisplayMode(mode) {
    let activeButton = {
        theme: "#theme-button",
        blank: "#blank-button",
        show: "#show-button"
    }[mode];

    $(".display-controls button")
            .toggleClass("active-button", false)
            .attr("aria-pressed", "false");
    if (activeButton) {
        $(activeButton)
                .addClass("active-button")
                .attr("aria-pressed", "true");
    }
}

function refreshCurrentItem() {
    $.getJSON("/api/v2/service/items")
            .done(function (items) {
                let currentItem = items.find(function (item) {
                    return item.selected;
                });
                let firstAvailableItem = items.find(function (item) {
                    return item.is_valid;
                });
                $("#start-first-item-button").prop("hidden", Boolean(currentItem) || !firstAvailableItem);
                $("#current-item").text(currentItem ? currentItem.title : $.i18n("no-live-item"));
                $("#connection-status").text($.i18n("connected"));
            })
            .fail(function () {
                $("#start-first-item-button").prop("hidden", true);
                $("#current-item").text($.i18n("no-live-item"));
                $("#connection-status").text($.i18n("connection-unavailable"));
            });
}

function startFirstServiceItem(button) {
    button.prop("disabled", true);
    $("#action-status").text("");
    $.getJSON("/api/v2/service/items")
            .done(function (items) {
                if (items.some(function (item) {
                    return item.selected;
                })) {
                    refreshCurrentItem();
                    button.prop("disabled", false);
                    return;
                }
                let firstAvailableItem = items.find(function (item) {
                    return item.is_valid;
                });
                if (!firstAvailableItem) {
                    $("#action-status").text($.i18n("no-valid-service-items"));
                    button.prop("disabled", false);
                    return;
                }
                $.ajax({
                    url: "/api/v2/service/show",
                    method: "POST",
                    contentType: "application/json",
                    data: JSON.stringify({id: firstAvailableItem.id})
                }).done(refreshCurrentItem).fail(showApiError).always(function () {
                    button.prop("disabled", false);
                });
            })
            .fail(function (xhr) {
                showApiError(xhr);
                button.prop("disabled", false);
            });
}

$(function () {
    loadSettings();
    settingsReady = true;
    updateNavigationLabels();
    updateNextPreview();
    refreshCurrentItem();
    window.setInterval(refreshCurrentItem, 1000);
    sendStageSettings();
    openlpChannel.postMessage(JSON.stringify({type: "displayModeRequest"}));
    //add listeners
    $("#title-layout-h-anchor").change(function () {
        let val = $(this).val();
        $("#title-layout-h-offset").val(0);
        window.localStorage.setItem("titleHAnchor", val);
        window.localStorage.setItem("titleHOffset", 0);
        transmitTitleLayout();
    });
    $("#title-layout-h-offset").change(function () {
        let val = $(this).val();
        window.localStorage.setItem("titleHOffset", val);
        transmitTitleLayout();
    });
    $("#title-layout-v-anchor").change(function () {
        var val = $(this).val();
        window.localStorage.setItem("titleVAnchor", val);
        transmitTitleLayout();
    });
    $("#lyrics-layout-h-anchor").change(function () {
        let val = $(this).val();
        $("#lyrics-layout-h-offset").val(0);
        window.localStorage.setItem("lyricsHAnchor", val);
        window.localStorage.setItem("lyricsHOffset", 0);
        transmitLyricsLayout();
    });
    $("#lyrics-layout-h-offset").change(function () {
        let val = $(this).val();
        window.localStorage.setItem("lyricsHOffset", val);
        transmitLyricsLayout();
    });
    $("#lyrics-layout-v-anchor").change(function () {
        var val = $(this).val();
        $("#lyrics-layout-v-offset").val(0);
        window.localStorage.setItem("lyricsVAnchor", val);
        window.localStorage.setItem("lyricsVOffset", 0);
        transmitLyricsLayout();
    });
    $("#lyrics-layout-v-offset").change(function () {
        let val = $(this).val();
        window.localStorage.setItem("lyricsVOffset", val);
        transmitLyricsLayout();
    });
    $("#lyrics-max-width-spinner").change(function () {
        let width = $(this).val();
        window.localStorage.setItem("maxWidth", width);
        openlpChannel.postMessage(JSON.stringify({type: "maxWidth", value: width}));
    });
    $("#lyrics-height-spinner").change(function () {
        let height = $(this).val();
        window.localStorage.setItem("lyricsHeight", height);
        openlpChannel.postMessage(JSON.stringify({type: "lyricsHeight", value: height}));
    });
    $("#image-fit-select").change(function () {
        let fit = $(this).val();
        window.localStorage.setItem("imageFit", fit);
        openlpChannel.postMessage(JSON.stringify({type: "imageFit", value: fit}));
    });
    $("legend[data-collapse]").click(function () {
        $(this).toggleClass("active-collapsible");
        let id = $(this).attr("data-collapse");
        let content = $("#" + id);
        id = id.replace("/-/g", "_");
        if (content.css("display") === "none") {
            content.css("display", "inline-block");
            window.localStorage.setItem("collapsed_" + id, false);
        } else {
            content.css("display", "none");
            window.localStorage.setItem("collapsed_" + id, true);
        }
    });
    $("#auto-update-checkbox").change(function () {
        window.localStorage.setItem("autoUpdate", $(this).prop("checked"));
    });
    $("#auto-hide-checkbox").change(function () {
        let checked = $(this).prop("checked");
        window.localStorage.setItem("autoHide", checked);
        openlpChannel.postMessage(JSON.stringify({type: "hideOnBlank", value: checked}));
    });
    $("#resize-checkbox").change(function () {
        autoResize = $(this).prop("checked");
        window.localStorage.setItem("autoResize", autoResize);
        openlpChannel.postMessage(JSON.stringify({type: "resize", value: autoResize}));
    });
    $("#display-all-checkbox").change(function () {
        window.localStorage.setItem("displayAll", $(this).prop("checked"));
    });
    $("#control-font-size-spinner").change(function () {
        let font = $(this).val();
        $("*").css({"font-size": font + "pt"});
        window.localStorage.setItem("controlFont", font);
    });
    $("#preview-line-count-spinner").change(function () {
        previewLineCount = Math.max(1, Math.min(20, Number($(this).val()) || 1));
        $(this).val(previewLineCount);
        window.localStorage.setItem("previewLineCount", previewLineCount);
        updateNextPreview();
    });
    $("#auto-split-long-lines-checkbox").change(function () {
        autoSplitLongLines = $(this).prop("checked");
        window.localStorage.setItem("autoSplitLongLines", autoSplitLongLines);
        updateCurrentLines();
        updateNextPreview();
        updateNavigationLabels();
        if (autoSplitLongLines) {
            $("#split-max-characters").show();
            $("#split-min-words").show();
        } else {
            $("#split-max-characters").hide();
            $("#split-min-words").hide();
        }
    });
    $("#split-max-characters-spinner").change(function () {
        maxCharacters = $(this).val();
        window.localStorage.setItem("maxCharacters", maxCharacters);
    });
    $("#split-min-words-spinner").change(function () {
        minWords = $(this).val();
        window.localStorage.setItem("minWords", minWords);
    });
    $("#text-formatting-all-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['all'] = checked;
        window.localStorage.setItem("textFormattingAll", textFormatting['all']);
        if (checked) {
            $(".text-formatting-checkbox").attr("disabled", true);
            $(".text-formatting-checkbox ~ label").addClass('disabled');
        } else {
            $(".text-formatting-checkbox").removeAttr("disabled");
            $(".text-formatting-checkbox ~ label").removeClass('disabled');
        }
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-bold-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['bold'] = checked;
        window.localStorage.setItem("textFormattingBold", textFormatting['bold']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-italics-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['italics'] = checked;
        window.localStorage.setItem("textFormattingItalics", textFormatting['italics']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-underline-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['underline'] = checked;
        window.localStorage.setItem("textFormattingUnderline", textFormatting['underline']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-colors-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['colors'] = checked;
        window.localStorage.setItem("textFormattingColors", textFormatting['colors']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-superscript-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['superscript'] = checked;
        window.localStorage.setItem("textFormattingSuperscript", textFormatting['superscript']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-subscript-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['subscript'] = checked;
        window.localStorage.setItem("textFormattingSubscript", textFormatting['subscript']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#text-formatting-paragraph-checkbox").change(function () {
        let checked = $(this).prop("checked");
        textFormatting['paragraph'] = checked;
        window.localStorage.setItem("textFormattingParagraph", textFormatting['paragraph']);
        openlpChannel.postMessage(JSON.stringify({type: "textFormatting", value: textFormatting}));
    });
    $("#title-visibility-song").change(function () {
        let checked = $(this).prop("checked");
        window.localStorage.setItem("titleVisibleSong", checked);
        openlpChannel.postMessage(JSON.stringify({type: "titleVisibility", song: checked}));
    });
    $("#title-visibility-scripture").change(function () {
        let checked = $(this).prop("checked");
        window.localStorage.setItem("titleVisibleScripture", checked);
        openlpChannel.postMessage(JSON.stringify({type: "titleVisibility", bible: checked}));
    });
    $("#lyrics-font-size-spinner").change(function () {
        let font = $(this).val();
        window.localStorage.setItem("lyricsFont", font);
        openlpChannel.postMessage(JSON.stringify({type: "lyricsFont", value: font}));
    });
    $("#title-font-size-spinner").change(function () {
        let font = $(this).val();
        window.localStorage.setItem("titleFont", font);
        openlpChannel.postMessage(JSON.stringify({type: "titleFont", value: font}));
    });
    $("#crossfade-duration-spinner").change(function () {
        crossfadeDuration = $(this).val();
        window.localStorage.setItem("crossfadeDuration", crossfadeDuration);
        openlpChannel.postMessage(JSON.stringify({type: "crossfadeDuration", value: crossfadeDuration}));
    });
    $("#fade-duration-spinner").change(function () {
        fadeDuration = $(this).val();
        window.localStorage.setItem("fadeDuration", fadeDuration);
        openlpChannel.postMessage(JSON.stringify({type: "fadeDuration", value: fadeDuration}));
    });
    $("#button-height-select").change(function () {
        let opt = $(this).val();
        updateButtonSize(opt);
        window.localStorage.setItem("buttonSize", opt);
    });
    $("#undo-button").click(function () {
        displaySaved(historyIndex + 1);
    });
    $("#redo-button").click(function () {
        displaySaved(historyIndex - 1);
    });
    $("#next-button").click(function () {
        $("#action-status").text("");
        if ($("#auto-split-long-lines-checkbox").prop("checked") && displayNext(1)) {
            return;
        }
        sendApiCommand("/api/v2/controller/progress", {action: "next"});
    });
    $("#previous-button").click(function () {
        $("#action-status").text("");
        if ($("#auto-split-long-lines-checkbox").prop("checked") && displayPrevious(1)) {
            return;
        }
        sendApiCommand("/api/v2/controller/progress", {action: "previous"});
    });
    $("#previous-item-button").click(function () {
        sendApiCommand("/api/v2/service/progress", {action: "previous"});
    });
    $("#next-item-button").click(function () {
        sendApiCommand("/api/v2/service/progress", {action: "next"});
    });
    $("#theme-button").click(function () {
        sendApiCommand("/api/v2/core/display", {display: "theme"});
    });
    $("#blank-button").click(function () {
        sendApiCommand("/api/v2/core/display", {display: "blank"});
    });
    $("#show-button").click(function () {
        sendApiCommand("/api/v2/core/display", {display: "show"});
    });
    $("#start-first-item-button").click(function () {
        startFirstServiceItem($(this));
    });
    $("#hide-button").click(function () {
        if (!hiding) {
            $(this).addClass("active-button");
            hiding = true;
        } else {
            $(this).removeClass("active-button");
            hiding = false;
        }
        openlpChannel.postMessage(JSON.stringify({type: "hide", value: hiding}));
    });
});
