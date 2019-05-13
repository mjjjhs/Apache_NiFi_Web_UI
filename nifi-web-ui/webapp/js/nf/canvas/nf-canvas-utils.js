/*
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* global define, module, require, exports */

(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['d3',
                'jquery',
                'nf.Common',
                'nf.ErrorHandler',
                'nf.Dialog',
                'nf.Clipboard',
                'nf.Storage'],
            function (d3, $, nfCommon, nfErrorHandler, nfDialog, nfClipboard, nfStorage) {
                return (nf.CanvasUtils = factory(d3, $, nfCommon, nfErrorHandler, nfDialog, nfClipboard, nfStorage));
            });
    } else if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = (nf.CanvasUtils = factory(
            require('d3'),
            require('jquery'),
            require('nf.Common'),
            require('nf.ErrorHandler'),
            require('nf.Dialog'),
            require('nf.Clipboard'),
            require('nf.Storage')));
    } else {
        nf.CanvasUtils = factory(
            root.d3,
            root.$,
            root.nf.Common,
            root.nf.ErrorHandler,
            root.nf.Dialog,
            root.nf.Clipboard,
            root.nf.Storage);
    }
}(this, function (d3, $, nfCommon, nfErrorHandler, nfDialog, nfClipboard, nfStorage) {
    'use strict';

    var nfCanvas;
    var nfActions;
    var nfSnippet;
    var nfBirdseye;
    var nfGraph;

    var restrictedUsage = d3.map();
    var requiredPermissions = d3.map();

    var config = {
        storage: {
            namePrefix: 'nifi-view-'
        },
        urls: {
            controller: '../nifi-api/controller'
        }
    };

    var MAX_URL_LENGTH = 2000;  // the maximum (suggested) safe string length of a URL supported by all browsers and application servers
    // 모든 브라우저 및 응용 프로그램 서버에서 지원하는 URL의 최대 (권장) 안전 문자열 길이

    var TWO_PI = 2 * Math.PI;

    var binarySearch = function (length, comparator) {
        var low = 0;
        var high = length - 1;
        var mid;

        var result = 0;
        while (low <= high) {
            mid = ~~((low + high) / 2);
            result = comparator(mid);
            if (result < 0) {
                high = mid - 1;
            } else if (result > 0) {
                low = mid + 1;
            } else {
                break;
            }
        }

        return mid;
    };

    var moveComponents = function (components, groupId) {
        return $.Deferred(function (deferred) {
            var parentGroupId = nfCanvasUtils.getGroupId();

            // create a snippet for the specified components
            // 지정된 구성 요소에 대한 스니펫을 만듭니다.
            var snippet = nfSnippet.marshal(components, parentGroupId);
            nfSnippet.create(snippet).done(function (response) {
                // move the snippet into the target
                // 스니펫을 대상으로 이동하십시오.
                nfSnippet.move(response.snippet.id, groupId).done(function () {
                    var componentMap = d3.map();

                    // add the id to the type's array
                    // 그 id를 타입의 배열에 추가한다.
                    var addComponent = function (type, id) {
                        if (!componentMap.has(type)) {
                            componentMap.set(type, []);
                        }
                        componentMap.get(type).push(id);
                    };

                    // go through each component being removed
                    // 제거되는 각 구성 요소를 검토하십시오.
                    components.each(function (d) {
                        addComponent(d.type, d.id);
                    });

                    // refresh all component types as necessary (handle components that have been removed)
                    // 필요한 경우 모든 구성 요소 유형을 새로 고치십시오 (제거 된 구성 요소 처리).
                    componentMap.each(function (ids, type) {
                        nfCanvasUtils.getComponentByType(type).remove(ids);
                    });

                    // refresh the birdseye
                    nfBirdseye.refresh();

                    deferred.resolve();
                }).fail(nfErrorHandler.handleAjaxError).fail(function () {
                    deferred.reject();
                });
            }).fail(nfErrorHandler.handleAjaxError).fail(function () {
                deferred.reject();
            });
        }).promise();
    };

    var nfCanvasUtils = {

        /**
         * Initialize the canvas utils.
         *
         * @param nfCanvasRef   The nfCanvas module.
         * @param nfActionsRef   The nfActions module.
         * @param nfSnippetRef   The nfSnippet module.
         * @param nfBirdseyeRef   The nfBirdseye module.
         * @param nfGraphRef   The nfGraph module.
         */
        init: function(nfCanvasRef, nfActionsRef, nfSnippetRef, nfBirdseyeRef, nfGraphRef){
            nfCanvas = nfCanvasRef;
            nfActions = nfActionsRef;
            nfSnippet = nfSnippetRef;
            nfBirdseye = nfBirdseyeRef;
            nfGraph = nfGraphRef;
        },

        config: {
            systemTooltipConfig: {
                style: {
                    classes: 'nifi-tooltip'
                },
                show: {
                    solo: true,
                    effect: false
                },
                hide: {
                    effect: false
                },
                position: {
                    at: 'bottom right',
                    my: 'top left'
                }
            }
        },

        /**
         * Gets a graph component `type`.
         * 그래프 컴퍼넌트`type`를 취득합니다.
         *
         * @param type  The type of component.
         */
        getComponentByType: function (type) {
            return nfGraph.getComponentByType(type);
        },

        /**
         * Calculates the point on the specified bounding box that is closest to the
         * specified point.
         * 지정된 점에 가장 가까운 지정된 경계 상자의 점을 계산합니다.
         *
         * @param {object} p            The point
         * @param {object} bBox         The bounding box
         */
        getPerimeterPoint: function (p, bBox) {
            // calculate theta
            // 세타 계산
            var theta = Math.atan2(bBox.height, bBox.width);

            // get the rectangle radius
            // 직사각형 반경을 얻는다.
            var xRadius = bBox.width / 2;
            var yRadius = bBox.height / 2;

            // get the center point
            // 중심점을 얻다.
            var cx = bBox.x + xRadius;
            var cy = bBox.y + yRadius;

            // calculate alpha
            // 알파를 계산하다
            var dx = p.x - cx;
            var dy = p.y - cy;
            var alpha = Math.atan2(dy, dx);

            // normalize aphla into 0 <= alpha < 2 PI
            // aphla를 0 <= alpha <2로 정규화
            alpha = alpha % TWO_PI;
            if (alpha < 0) {
                alpha += TWO_PI;
            }

            // calculate beta
            // 베타 계산하다
            var beta = (Math.PI / 2) - alpha;

            // detect the appropriate quadrant and return the point on the perimeter
            // 적절한 사분면을 검출하고 주변상의 점을 되 돌린다.
            if ((alpha >= 0 && alpha < theta) || (alpha >= (TWO_PI - theta) && alpha < TWO_PI)) {
                // right quadrant
                // 오른쪽 사분면
                return {
                    'x': bBox.x + bBox.width,
                    'y': cy + Math.tan(alpha) * xRadius
                };
            } else if (alpha >= theta && alpha < (Math.PI - theta)) {
                // bottom quadrant
                // 하단 사분면
                return {
                    'x': cx + Math.tan(beta) * yRadius,
                    'y': bBox.y + bBox.height
                };
            } else if (alpha >= (Math.PI - theta) && alpha < (Math.PI + theta)) {
                // left quadrant
                // 왼쪽 사분면
                return {
                    'x': bBox.x,
                    'y': cy - Math.tan(alpha) * xRadius
                };
            } else {
                // top quadrant
                // 상단 사분면
                return {
                    'x': cx - Math.tan(beta) * yRadius,
                    'y': bBox.y
                };
            }
        },

        /**
         * Queries for bulletins for the specified components.
         * 지정된 구성 요소의 게시판을 쿼리합니다.
         *
         * @param {array} componentIds
         * @returns {deferred}
         */
        queryBulletins: function (componentIds) {
            var queries = [];

            var query = function (ids) {
                var url = new URL(window.location);
                var origin = nfCommon.substringBeforeLast(url.href, '/nifi');
                var endpoint = origin + '/nifi-api/flow/bulletin-board?' + $.param({
                    sourceId: ids.join('|')
                });

                if (endpoint.length > MAX_URL_LENGTH) {
                    // split into two arrays and recurse with both halves
                    var mid = Math.ceil(ids.length / 2);

                    // left half
                    var left = ids.slice(0, mid);
                    if (left.length > 0) {
                        query(left);
                    }

                    // right half
                    var right = ids.slice(mid);
                    if (right.length > 0) {
                        query(right);
                    }
                } else {
                    queries.push($.ajax({
                        type: 'GET',
                        url: endpoint,
                        dataType: 'json'
                    }));
                }
            };

            // initiate the queries
            // 쿼리를 시작하십시오.
            query(componentIds);

            if (queries.length === 1) {
                // if there was only one query, return it
                // 쿼리가 하나만있는 경우 반환하십시오.
                return $.Deferred(function (deferred) {
                    queries[0].done(function (response) {
                        deferred.resolve(response);
                    }).fail(function () {
                        deferred.reject();
                    }).fail(nfErrorHandler.handleAjaxError);
                }).promise();
            } else {
                // if there were multiple queries, wait for each to complete
                // 여러 개의 쿼리가있는 경우 각 쿼리가 완료 될 때까지 기다립니다.
                return $.Deferred(function (deferred) {
                    $.when.apply(window, queries).done(function () {
                        var results = $.makeArray(arguments);

                        var generated = null;
                        var bulletins = [];

                        $.each(results, function (_, result) {
                            var response = result[0];
                            var bulletinBoard = response.bulletinBoard;

                            // use the first generated timestamp
                            // 최초로 생성 된 타임 스탬프를 사용한다.
                            if (generated === null) {
                                generated = bulletinBoard.generated;
                            }

                            // build up all the bulletins
                            // 모든 게시판을 빌드업
                            Array.prototype.push.apply(bulletins, bulletinBoard.bulletins);
                        });

                        // sort all the bulletins
                        // 모든 게시판 정렬
                        bulletins.sort(function (a, b) {
                            return b.id - a.id;
                        });

                        // resolve with a aggregated result
                        // 집계 된 결과로 해결하다
                        deferred.resolve({
                            bulletinBoard: {
                                generated: generated,
                                bulletins: bulletins
                            }
                        });
                    }).fail(function () {
                        deferred.reject();
                    }).fail(nfErrorHandler.handleAjaxError);
                }).promise();
            }
        },

        /**
         * Shows the specified component in the specified group.
         * 지정된 그룹에 지정된 구성 요소를 표시합니다.
         *
         * @param {string} groupId       The id of the group
         * @param {string} componentId   The id of the component
         */
        showComponent: function (groupId, componentId) {
            // ensure the group id is specified
            // 그룹 ID가 지정되었는지 확인하십시오.
            if (nfCommon.isDefinedAndNotNull(groupId)) {
                // initiate a graph refresh
                // 그래프 새로 고침 시작
                var refreshGraph = $.Deferred(function (deferred) {
                    // load a different group if necessary
                    // 필요한 경우 다른 그룹로드
                    if (groupId !== nfCanvas.getGroupId()) {
                        // load the process group
                        // 프로세스 그룹로드
                        nfCanvas.reload({}, groupId).done(function () {
                            deferred.resolve();
                        }).fail(function (xhr, status, error) {
                            nfDialog.showOkDialog({
                                headerText: 'Error',
                                dialogContent: 'Unable to load the group for the specified component.'
                            });
                            deferred.reject(xhr, status, error);
                        });
                    } else {
                        deferred.resolve();
                    }
                }).promise();

                // when the refresh has completed, select the match
                // 새로 고침이 완료되면 일치 항목을 선택하십시오.
                refreshGraph.done(function () {
                    // attempt to locate the corresponding component
                    // 해당 구성 요소를 찾으려고 시도한다.
                    var component = d3.select('#id-' + componentId);
                    if (!component.empty()) {
                        nfActions.show(component);
                    } else {
                        nfDialog.showOkDialog({
                            headerText: 'Error',
                            dialogContent: 'Unable to find the specified component.'
                        });
                    }
                });

                return refreshGraph;
            } else {
                return $.Deferred(function (deferred) {
                    deferred.reject();
                }).promise();
            }
        },

        /**
         * Displays the URL deep link on the canvas.
         * 캔버스에 URL 딥 링크를 표시합니다.
         *
         * @param forceCanvasLoad   Boolean enabling the update of the URL parameters. URL 매개 변수의 업데이트를 사용하는 부울입니다.
         */
        showDeepLink: function (forceCanvasLoad) {
            // deselect components
            // 구성 요소 선택 취소
            nfCanvasUtils.getSelection().classed('selected', false);

            // close the ok dialog if open
            // 열려있는 경우 확인 대화 상자를 닫습니다.
            if ($('#nf-ok-dialog').is(':visible') === true) {
                $('#nf-ok-dialog').modal('hide');
            }

            // Feature detection and browser support for URLSearchParams
            // URLSearchParams에 대한 기능 감지 및 브라우저 지원
            if ('URLSearchParams' in window) {
                // get the `urlSearchParams` from the URL
                // URL로부터`urlSearchParams`를 얻습니다.
                var urlSearchParams = new URL(window.location).searchParams;
                // if the `urlSearchParams` are `undefined` then the browser does not support
                // the URL object's `.searchParams` property
                // `urlSearchParams`가`undefined`이면 브라우저는 URL 객체의`.searchParams` 속성을 지원하지 않습니다
                if (!nf.Common.isDefinedAndNotNull(urlSearchParams)) {
                    // attempt to get the `urlSearchParams` using the URLSearchParams constructor and
                    // the URL object's `.search` property
                    // URLSearchParams 생성자와 URL 객체의`.search` 속성을 사용하여`urlSearchParams`를 얻으려고 시도하십시오.
                    urlSearchParams = new URLSearchParams(new URL(window.location).search);
                }

                var groupId = nfCanvasUtils.getGroupId();

                // if the `urlSearchParams` are still `undefined` then the browser does not support
                // the URL object's `.search` property. In this case we cannot support deep links.
                // `urlSearchParams`가 여전히`undefined` 인 경우 브라우저는 URL 객체의`.search` 속성을 지원하지 않습니다. 이 경우 딥 링크를 지원할 수 없습니다.
                if (nf.Common.isDefinedAndNotNull(urlSearchParams)) {
                    var componentIds = [];

                    if (urlSearchParams.get('processGroupId')) {
                        groupId = urlSearchParams.get('processGroupId');
                    }
                    if (urlSearchParams.get('componentIds')) {
                        componentIds = urlSearchParams.get('componentIds').split(',');
                    }

                    // load the graph but do not update the browser history
                    // 그래프를 로드하지만 브라우저 기록을 업데이트하지 않습니다.
                    if (componentIds.length >= 1) {
                        return nfCanvasUtils.showComponents(groupId, componentIds, forceCanvasLoad);
                    } else {
                        return nfCanvasUtils.getComponentByType('ProcessGroup').enterGroup(groupId);
                    }
                } else {
                    return nfCanvasUtils.getComponentByType('ProcessGroup').enterGroup(groupId);
                }
            }
        },

        /**
         * Shows the specified components in the specified group.
         * 지정한 그룹의 지정된 구성 요소를 표시합니다.
         *
         * @param {string} groupId       The id of the group
         * @param {array} componentIds   The ids of the components
         * @param {bool} forceCanvasLoad   Boolean to force reload of the canvas.
         */
        showComponents: function (groupId, componentIds, forceCanvasLoad) {
            // ensure the group id is specified
            // 그룹 ID가 지정되었는지 확인하십시오.
            if (nfCommon.isDefinedAndNotNull(groupId)) {
                // initiate a graph refresh
                var refreshGraph = $.Deferred(function (deferred) {
                    // load a different group if necessary
                    // 필요한 경우 다른 그룹로드
                    if (groupId !== nfCanvas.getGroupId() || forceCanvasLoad) {
                        // load the process group
                        // 프로세스 그룹로드
                        nfCanvas.reload({}, groupId).done(function () {
                            deferred.resolve();
                        }).fail(function (xhr, status, error) {
                            nfDialog.showOkDialog({
                                headerText: 'Error',
                                dialogContent: 'Unable to enter the selected group.'
                            });

                            deferred.reject(xhr, status, error);
                        });
                    } else {
                        deferred.resolve();
                    }
                }).promise();

                // when the refresh has completed, select the match
                // 새로 고침이 완료되면 일치 항목을 선택하십시오.
                refreshGraph.done(function () {
                    // get the components to select
                    // 선택할 구성 요소 가져 오기
                    var components = d3.selectAll('g.component, g.connection').filter(function (d) {
                        if (componentIds.indexOf(d.id) >= 0) {
                            // remove located components from array so that only unfound components will remain
                            // 발견되지 않은 구성 요소 만 남도록 배열에서 찾은 구성 요소를 제거합니다.
                            componentIds.splice(componentIds.indexOf(d.id), 1);
                            return d;
                        }
                    });

                    if (componentIds.length > 0) {
                        var dialogContent = $('<p></p>').text('Specified component(s) not found: ' + componentIds.join(', ') + '.').append('<br/><br/>').append($('<p>Unable to select component(s).</p>'));

                        nfDialog.showOkDialog({
                            headerText: 'Error',
                            dialogContent: dialogContent
                        });
                    }

                    nfActions.show(components);
                });

                return refreshGraph;
            }
        },

        /**
         * Set the parameters of the URL.
         *
         * @param groupId       The process group id.
         * @param selections    The component ids.
         */
        setURLParameters: function (groupId, selections) {
            // Feature detection and browser support for URLSearchParams
            // URLSearchParams에 대한 기능 감지 및 브라우저 지원
            if ('URLSearchParams' in window) {
                if (!nfCommon.isDefinedAndNotNull(groupId)) {
                    groupId = nfCanvasUtils.getGroupId();
                }

                if (!nfCommon.isDefinedAndNotNull(selections)) {
                    selections = nfCanvasUtils.getSelection();
                }

                var selectedComponentIds = [];
                selections.each(function (selection) {
                    selectedComponentIds.push(selection.id);
                });

                // get all URL parameters
                var url = new URL(window.location);

                // get the `params` from the URL
                var params = new URL(window.location).searchParams;
                // if the `params` are undefined then the browser does not support
                // the URL object's `.searchParams` property
                // `params`가 정의되지 않은 경우 브라우저는 URL 객체의`.searchParams` 속성을 지원하지 않습니다
                if (!nf.Common.isDefinedAndNotNull(params)) {
                    // attempt to get the `params` using the URLSearchParams constructor and
                    // the URL object's `.search` property
                    // URLSearchParams 생성자와 URL 객체의`.search` 속성을 사용하여`params`를 얻으려고 시도하십시오ㅍ
                    params = new URLSearchParams(url.search);
                }

                // if the `params` are still `undefined` then the browser does not support
                // the URL object's `.search` property. In this case we cannot support deep links.
                // `params`가 여전히`undefined` 인 경우 브라우저는 URL 객체의`.search` 속성을 지원하지 않습니다. 이 경우 딥 링크를 지원할 수 없습니다.
                if (nf.Common.isDefinedAndNotNull(params)) {
                    var params = new URLSearchParams(url.search);
                    params.set('processGroupId', groupId);
                    params.set('componentIds', selectedComponentIds.sort());

                    var newUrl = url.origin + url.pathname;

                    if (nfCommon.isDefinedAndNotNull(nfCanvasUtils.getParentGroupId()) || selectedComponentIds.length > 0) {
                        if (!nfCommon.isDefinedAndNotNull(nfCanvasUtils.getParentGroupId())) {
                            // we are in the root group so set processGroupId param value to 'root' alias
                            // 우리는 루트 그룹에 있으므로 processGroupId 매개 변수 값을 'root'별칭으로 설정합니다
                            params.set('processGroupId', 'root');
                        }

                        if ((url.origin + url.pathname + '?' + params.toString()).length <= MAX_URL_LENGTH) {
                            newUrl = url.origin + url.pathname + '?' + params.toString();
                        } else if (nfCommon.isDefinedAndNotNull(nfCanvasUtils.getParentGroupId())) {
                            // silently remove all component ids
                            // 모든 구성 요소 ID를 자동으로 제거합니다.
                            params.set('componentIds', '');
                            newUrl = url.origin + url.pathname + '?' + params.toString();
                        }
                    }

                    window.history.replaceState({'previous_url': url.href}, window.document.title, newUrl);
                }
            }
        },

        /**
         * Gets the currently selected components and connections.
         * 현재 선택된 구성 요소 및 연결을 가져옵니다.
         *
         * @returns {selection}     The currently selected components and connections 현재 선택된 구성 요소 및 연결
         */
        getSelection: function () {
            return d3.selectAll('g.component.selected, g.connection.selected');
        },

        /**
         * Gets the selection object of the id passed.
         * 건네받은 ID의 선택 객체를 가져옵니다.
         *
         * @param {id}              The uuid of the component to retrieve 검색 할 구성 요소의 ID입니다.
         * @returns {selection}     The selection object of the component id passed 전달 된 구성 요소 ID의 선택 객체입니다.
         */
        getSelectionById: function(id){
            return d3.select('#id-' + id);
        },

        /**
         * Gets the coordinates neccessary to center a bounding box on the screen.
         * 화면상의 경계 상자를 중앙에 배치하는 데 필요한 좌표를 가져옵니다.
         *
         * @param {type} boundingBox
         * @returns {number[]}
         */
        getCenterForBoundingBox: function (boundingBox) {
            var scale = nfCanvas.View.getScale();
            if (nfCommon.isDefinedAndNotNull(boundingBox.scale)) {
                scale = boundingBox.scale;
            }

            // get the canvas normalized width and height
            // canvas를 표준화 된 너비와 높이로 가져옵니다.
            var canvasContainer = $('#canvas-container');
            var screenWidth = canvasContainer.width() / scale;
            var screenHeight = canvasContainer.height() / scale;

            // determine the center location for this component in canvas space
            // 캔버스 공간에서이 구성 요소의 중심 위치 결정
            var center = [(screenWidth / 2) - (boundingBox.width / 2), (screenHeight / 2) - (boundingBox.height / 2)];
            return center;
        },

        /**
         * Determines if a bounding box is fully in the current viewable canvas area.
         * 경계 상자가 현재 볼 수있는 캔버스 영역에 완전히 있는지 결정합니다.
         *
         * @param {type} boundingBox       Bounding box to check. 검사 할 경계 상자.
         * @param {boolean} strict         If true, the entire bounding box must be in the viewport. 
         *                                 If false, only part of the bounding box must be in the viewport. 
         * true 인 경우 경계 상자 전체가 뷰포트에 있어야합니다.
         * false 인 경우 경계 상자의 일부만 뷰포트에 있어야합니다.
         * @returns {boolean}
         */
        isBoundingBoxInViewport: function (boundingBox, strict) {
            var scale = nfCanvas.View.getScale();
            var translate = nfCanvas.View.getTranslate();
            var offset = nfCanvas.CANVAS_OFFSET;

            // get the canvas normalized width and height
            // canvas를 표준화 된 너비와 높이로 가져옵니다.
            var canvasContainer = $('#canvas-container');
            var screenWidth = Math.floor(canvasContainer.width() / scale);
            var screenHeight = Math.floor(canvasContainer.height() / scale);
            var screenLeft = Math.ceil(-translate[0] / scale);
            var screenTop = Math.ceil(-translate[1] / scale);
            var screenRight = screenLeft + screenWidth;
            var screenBottom = screenTop + screenHeight;

            var left = Math.ceil(boundingBox.x);
            var right = Math.floor(boundingBox.x + boundingBox.width);
            var top = Math.ceil(boundingBox.y - (offset) / scale);
            var bottom = Math.floor(boundingBox.y - (offset / scale) + boundingBox.height);

            if (strict) {
                return !(left < screenLeft || right > screenRight || top < screenTop || bottom > screenBottom);
            } else {
                return ((left > screenLeft && left < screenRight) || (right < screenRight && right > screenLeft)) &&
                    ((top > screenTop && top < screenBottom) || (bottom < screenBottom && bottom > screenTop));
            }
        },

        /**
         * Centers the specified bounding box.
         * 지정된 경계 상자를 가운데에 맞춥니다.
         *
         * @param {type} boundingBox
         */
        centerBoundingBox: function (boundingBox) {
            var scale = nfCanvas.View.getScale();
            if (nfCommon.isDefinedAndNotNull(boundingBox.scale)) {
                scale = boundingBox.scale;
            }

            var center = nfCanvasUtils.getCenterForBoundingBox(boundingBox);

            // calculate the difference between the center point and the position of this component and convert to screen space
            // 중심점과이 구성 요소의 위치 사이의 차이를 계산하고 화면 공간으로 변환합니다.
            nfCanvas.View.transform([(center[0] - boundingBox.x) * scale, (center[1] - boundingBox.y) * scale], scale);
        },

        /**
         * Enables/disables the editable behavior for the specified selection based on their access policies.
         * 액세스 정책을 기반으로 지정된 선택 항목에 대해 편집 가능한 동작을 활성화 / 비활성화합니다.
         *
         * @param selection     selection
         * @param nfConnectableRef   The nfConnectable module.
         * @param nfDraggableRef   The nfDraggable module.
         */
        editable: function (selection, nfConnectableRef, nfDraggableRef) {
            if (nfCanvasUtils.canModify(selection)) {
                if (!selection.classed('connectable')) {
                    selection.call(nfConnectableRef.activate);
                }
                if (!selection.classed('moveable')) {
                    selection.call(nfDraggableRef.activate);
                }
            } else {
                if (selection.classed('connectable')) {
                    selection.call(nfConnectableRef.deactivate);
                }
                if (selection.classed('moveable')) {
                    selection.call(nfDraggableRef.deactivate);
                }
            }
        },

        /**
         * Conditionally apply the transition.
         * 조건부로 전환을 적용합니다.
         *
         * @param selection     selection
         * @param transition    transition
         */
        transition: function (selection, transition) {
            if (transition && !selection.empty()) {
                return selection.transition().duration(400);
            } else {
                return selection;
            }
        },

        /**
         * Position the component accordingly.
         * 그에 따라 구성요소를 배치합니다.
         *
         * @param {selection} updated
         */
        position: function (updated, transition) {
            if (updated.empty()) {
                return;
            }

            return nfCanvasUtils.transition(updated, transition)
                .attr('transform', function (d) {
                    return 'translate(' + d.position.x + ', ' + d.position.y + ')';
                });
        },

        /**
         * Applies single line ellipsis to the component in the specified selection if necessary.
         * 필요한 경우 지정된 선택 영역의 구성 요소에 줄 바꿈 줄임표를 적용합니다.
         *
         * @param {selection} selection
         * @param {string} text
         */
        ellipsis: function (selection, text) {
            text = text.trim();
            var width = parseInt(selection.attr('width'), 10);
            var node = selection.node();

            // set the element text
            selection.text(text);

            // see if the field is too big for the field
            // 필드가 필드에 비해 너무 큰지 확인하십시오.
            if (text.length > 0 && node.getSubStringLength(0, text.length - 1) > width) {
                // make some room for the ellipsis
                // 줄임표를위한 공간을 만들어라.
                width -= 5;

                // determine the appropriate index
                // 적절한 색인을 결정한다.
                var i = binarySearch(text.length, function (x) {
                    var length = node.getSubStringLength(0, x);
                    if (length > width) {
                        // length is too long, try the lower half
                        // 길이가 너무 깁니다. 하반부를 시도하십시오.
                        return -1;
                    } else if (length < width) {
                        // length is too short, try the upper half
                        // 길이가 너무 짧다면, 상반부를 시도하십시오.
                        return 1;
                    }
                    return 0;
                });

                // trim at the appropriate length and add ellipsis
                // 적절한 길이로 자르고 줄임표를 추가하십시오.
                selection.text(text.substring(0, i) + String.fromCharCode(8230));
            }
        },

        /**
         * Applies multiline ellipsis to the component in the specified seleciton. Text will
         * wrap for the specified number of lines. The last line will be ellipsis if necessary.
         * 지정된 선택 영역의 구성 요소에 여러 줄 줄임표를 적용합니다. 지정된 줄 수만큼 텍스트가 줄 바꿈됩니다. 마지막 줄은 필요한 경우 줄임표입니다.
         *
         * @param {selection} selection
         * @param {integer} lineCount
         * @param {string} text
         */
        multilineEllipsis: function (selection, lineCount, text) {
            var i = 1;
            var words = text.split(/\s+/).reverse();

            // get the appropriate position
            // 적절한 위치를 얻는다.
            var x = parseInt(selection.attr('x'), 10);
            var y = parseInt(selection.attr('y'), 10);
            var width = parseInt(selection.attr('width'), 10);

            var line = [];
            var tspan = selection.append('tspan')
                .attrs({
                    'x': x,
                    'y': y,
                    'width': width
                });

            // go through each word
            // 각 단어를 살펴라.
            var word = words.pop();
            while (nfCommon.isDefinedAndNotNull(word)) {
                // add the current word
                // 현재 단어 추가
                line.push(word);

                // update the label text
                // 라벨 텍스트를 갱신한다.
                tspan.text(line.join(' '));

                // if this word caused us to go too far
                // 이 말 때문에 우리가 너무 멀어지게되면
                if (tspan.node().getComputedTextLength() > width) {
                    // remove the current word
                    // 현재 단어 삭제
                    line.pop();

                    // update the label text
                    // 라벨 텍스트를 갱신한다.
                    tspan.text(line.join(' '));

                    // create the tspan for the next line
                    // 다음 줄에 대한 tspan을 만든다.
                    tspan = selection.append('tspan')
                        .attrs({
                            'x': x,
                            'dy': '1.2em',
                            'width': width
                        });

                    // if we've reached the last line, use single line ellipsis
                    // 마지막 행에 도달하면 줄 바꿈 줄임표를 사용하십시오.
                    if (++i >= lineCount) {
                        // get the remainder using the current word and
                        // reversing whats left
                        // 현재의 단어를 사용하고 남은 것을 반대로 하여 나머지를 얻다.
                        var remainder = [word].concat(words.reverse());

                        // apply ellipsis to the last line
                        // 마지막 줄에 타원을 붙이다
                        nfCanvasUtils.ellipsis(tspan, remainder.join(' '));

                        // we've reached the line count
                        // 우리는 줄에 도달했다.
                        break;
                    } else {
                        tspan.text(word);

                        // prep the line for the next iteration
                        // 다음 반복을 위해 줄을 준비하다
                        line = [word];
                    }
                }

                // get the next word
                word = words.pop();
            }
        },

        /**
         * Updates the active thread count on the specified selection.
         * 지정된 선택 영역의 활성 스레드 수를 업데이트합니다.
         *
         * @param {selection} selection         The selection
         * @param {object} d                    The data
         * @param {function} setOffset          Optional function to handle the width of the active thread count component 활성 스레드 수 구성 요소의 너비를 처리하는 선택적 기능
         * @return
         */
        activeThreadCount: function (selection, d, setOffset) {
            var activeThreads = d.status.aggregateSnapshot.activeThreadCount;
            var terminatedThreads = d.status.aggregateSnapshot.terminatedThreadCount;

            // if there is active threads show the count, otherwise hide
            // 활성 스레드가 카운트를 표시하면 숨깁니다
            if (activeThreads > 0 || terminatedThreads > 0) {
                var generateThreadsTip = function () {
                    var tip = activeThreads + ' active threads';
                    if (terminatedThreads > 0) {
                        tip += ' (' + terminatedThreads + ' terminated)';
                    }

                    return tip;
                };

                // update the active thread count
                // 활성 스레드 수 업데이트
                var activeThreadCount = selection.select('text.active-thread-count')
                    .text(function () {
                        if (terminatedThreads > 0) {
                            return activeThreads + ' (' + terminatedThreads + ')';
                        } else {
                            return activeThreads;
                        }
                    })
                    .style('display', 'block')
                    .each(function () {
                        var activeThreadCountText = d3.select(this);

                        var bBox = this.getBBox();
                        activeThreadCountText.attr('x', function () {
                            return d.dimensions.width - bBox.width - 15;
                        });

                        // reset the active thread count tooltip
                        // 활성 스레드 수 도구 팁 재설정
                        activeThreadCountText.selectAll('title').remove();
                    });

                // append the tooltip
                activeThreadCount.append('title').text(generateThreadsTip);

                // update the background width
                selection.select('text.active-thread-count-icon')
                    .attr('x', function () {
                        var bBox = activeThreadCount.node().getBBox();

                        // update the offset
                        if (typeof setOffset === 'function') {
                            setOffset(bBox.width + 6);
                        }

                        return d.dimensions.width - bBox.width - 20;
                    })
                    .style('fill', function () {
                        if (terminatedThreads > 0) {
                            return '#ba554a';
                        } else {
                            return '#728e9b';
                        }
                    })
                    .style('display', 'block')
                    .each(function () {
                        var activeThreadCountIcon = d3.select(this);

                        // reset the active thread count tooltip
                        activeThreadCountIcon.selectAll('title').remove();
                    }).append('title').text(generateThreadsTip);
            } else {
                selection.selectAll('text.active-thread-count, text.active-thread-count-icon')
                    .style('display', 'none')
                    .each(function () {
                        d3.select(this).selectAll('title').remove();
                    });
            }
        },

        /**
         * Disables the default browser behavior of following image href when control clicking.
         * 컨트롤 클릭시 다음 이미지 href의 기본 브라우저 동작을 비활성화합니다.
         *
         * @param {selection} selection                 The image
         */
        disableImageHref: function (selection) {
            selection.on('click.disableImageHref', function () {
                if (d3.event.ctrlKey || d3.event.shiftKey) {
                    d3.event.preventDefault();
                }
            });
        },

        /**
         * Handles component bulletins.
         * 구성 요소 게시판을 처리합니다.
         *
         * @param {selection} selection                    The component
         * @param {object} d                                The data
         * @param {function} getTooltipContainer            Function to get the tooltip container 도구 설명 컨테이너를 가져 오는 기능
         * @param {function} offset                         Optional offset
         */
        bulletins: function (selection, d, getTooltipContainer, offset) {
            offset = nfCommon.isDefinedAndNotNull(offset) ? offset : 0;

            // get the tip
            var tip = d3.select('#bulletin-tip-' + d.id);

            var hasBulletins = false;
            if (!nfCommon.isEmpty(d.bulletins)) {
                // format the bulletins
                // 게시판을 포맷하다.
                var bulletins = nfCommon.getFormattedBulletins(d.bulletins);
                hasBulletins = bulletins.length > 0;

                if (hasBulletins) {
                    // create the unordered list based off the formatted bulletins
                    // 서식이 지정된 게시판을 기반으로 정렬되지 않은 목록을 만듭니다.
                    var list = nfCommon.formatUnorderedList(bulletins);
                }
            }

            // if there are bulletins show them, otherwise hide
            // 게시판에 게시판이있는 경우, 그렇지 않으면 숨기기
            if (hasBulletins) {
                // update the tooltip
                selection.select('text.bulletin-icon')
                    .each(function () {
                        // create the tip if necessary
                        if (tip.empty()) {
                            tip = getTooltipContainer().append('div')
                                .attr('id', function () {
                                    return 'bulletin-tip-' + d.id;
                                })
                                .attr('class', 'tooltip nifi-tooltip');
                        }

                        // add the tooltip
                        tip.html(function () {
                            return $('<div></div>').append(list).html();
                        });

                        nfCanvasUtils.canvasTooltip(tip, d3.select(this));
                    });

                // update the tooltip background
                selection.select('text.bulletin-icon').style("visibility", "visible");
                selection.select('rect.bulletin-background').style("visibility", "visible");
            } else {
                // clean up if necessary
                if (!tip.empty()) {
                    tip.remove();
                }

                // update the tooltip background
                selection.select('text.bulletin-icon').style("visibility", "hidden");
                selection.select('rect.bulletin-background').style("visibility", "hidden");
            }
        },

        /**
         * Adds the specified tooltip to the specified target.
         * 지정된 툴 힌트를 지정된 타겟에 추가합니다.
         *
         * @param {selection} tip           The tooltip
         * @param {selection} target        The target of the tooltip
         */
        canvasTooltip: function (tip, target) {
            target.on('mouseenter', function () {
                tip.style('top', (d3.event.pageY + 15) + 'px').style('left', (d3.event.pageX + 15) + 'px').style('display', 'block');
            })
                .on('mousemove', function () {
                    tip.style('top', (d3.event.pageY + 15) + 'px').style('left', (d3.event.pageX + 15) + 'px');
                })
                .on('mouseleave', function () {
                    tip.style('display', 'none');
                });
        },

        /**
         * Determines if the specified selection is alignable (in a single action).
         * 지정된 선택 항목을 정렬 할 수 있는지 (단일 조치로) 결정합니다.
         *
         * @param {selection} selection     The selection
         * @returns {boolean}
         */
        canAlign: function(selection) {
            var canAlign = true;

            // determine if the current selection is entirely connections
            // 현재 선택이 완전히 연결되었는지 확인
            var selectedConnections = selection.filter(function(d) {
                var connection = d3.select(this);
                return nfCanvasUtils.isConnection(connection);
            });

            // require multiple selections besides connections
            // 연결 외에 여러 개의 선택이 필요하다.
            if (selection.size() - selectedConnections.size() < 2) {
                canAlign = false;
            }

            // require write permissions
            // 쓰기 권한이 필요하다.
            if (nfCanvasUtils.canModify(selection) === false) {
                canAlign = false;
            }

            return canAlign;
        },

        /**
         * Determines if the specified selection is colorable (in a single action).
         * 지정된 선택 영역에 색을 지정할 수 있는지 (단일 조치로) 결정합니다.
         *
         * @param {selection} selection     The selection
         * @returns {boolean}
         */
        isColorable: function(selection) {
            if (selection.empty()) {
                return false;
            }

            // require read and write permissions
            // 읽기 및 쓰기 권한이 필요합니다.
            if (nfCanvasUtils.canRead(selection) === false || nfCanvasUtils.canModify(selection) === false) {
                return false;
            }

            // determine if the current selection is entirely processors or labels
            // 현재 선택이 전적으로 프로세서인지 레이블인지 확인하십시오.
            var selectedProcessors = selection.filter(function(d) {
                var processor = d3.select(this);
                return nfCanvasUtils.isProcessor(processor) && nfCanvasUtils.canModify(processor);
            });
            var selectedLabels = selection.filter(function(d) {
                var label = d3.select(this);
                return nfCanvasUtils.isLabel(label) && nfCanvasUtils.canModify(label);
            });

            var allProcessors = selectedProcessors.size() === selection.size();
            var allLabels = selectedLabels.size() === selection.size();

            return allProcessors || allLabels;
        },

        /**
         * Determines if the specified selection is a connection.
         * 지정한 선택사항이 연결인지 여부를 결정합니다.
         *
         * @argument {selection} selection      The selection
         */
        isConnection: function (selection) {
            return selection.classed('connection');
        },

        /**
         * Determines if the specified selection is a remote process group.
         * 지정된 선택 항목이 원격 프로세스 그룹인지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         */
        isRemoteProcessGroup: function (selection) {
            return selection.classed('remote-process-group');
        },

        /**
         * Determines if the specified selection is a processor.
         * 지정된 선택 영역이 프로세서인지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         */
        isProcessor: function (selection) {
            return selection.classed('processor');
        },

        /**
         * Determines if the specified selection is a label.
         * 지정된 선택이 label 일지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         */
        isLabel: function (selection) {
            return selection.classed('label');
        },

        /**
         * Determines if the specified selection is an input port.
         * 지정된 선택이 입력 포트 일지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         */
        isInputPort: function (selection) {
            return selection.classed('input-port');
        },

        /**
         * Determines if the specified selection is an output port.
         * 지정된 선택이 출력 포트 일지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         */
        isOutputPort: function (selection) {
            return selection.classed('output-port');
        },

        /**
         * Determines if the specified selection is a process group.
         *
         * @argument {selection} selection      The selection
         */
        isProcessGroup: function (selection) {
            return selection.classed('process-group');
        },

        /**
         * Determines if the specified selection is a funnel.
         *
         * @argument {selection} selection      The selection
         */
        isFunnel: function (selection) {
            return selection.classed('funnel');
        },

        /**
         * Determines if the components in the specified selection are runnable.
         * 지정된 선택 범위의 컴퍼넌트가 실행 가능한지 어떤지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection is runnable 선택 항목이 실행 가능한지 여부
         */
        areRunnable: function (selection) {
            if (selection.empty()) {
                return true;
            }

            var runnable = true;
            selection.each(function () {
                if (!nfCanvasUtils.isRunnable(d3.select(this))) {
                    runnable = false;
                    return false;
                }
            });

            return runnable;
        },

        /**
         * Determines if the component in the specified selection is runnable.
         * 지정된 선택 범위의 구성 요소가 실행 가능한지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection is runnable 선택 항목이 실행 가능한지 여부
         */
        isRunnable: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            if (nfCanvasUtils.isProcessGroup(selection)) {
                return true;
            }

            if (nfCanvasUtils.canOperate(selection) === false) {
                return false;
            }

            var runnable = false;
            var selectionData = selection.datum();
            if (nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isOutputPort(selection)) {
                runnable = nfCanvasUtils.supportsModification(selection) && selectionData.status.aggregateSnapshot.runStatus === 'Stopped';
            }

            return runnable;
        },

        /**
         * Determines if the components in the specified selection are stoppable.
         * 지정된 선택 범위의 컴퍼넌트가 정지 가능한지 어떤지를 판별합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection is stoppable 선택 항목을 멈출 수 있는지 여부
         */
        areStoppable: function (selection) {
            if (selection.empty()) {
                return true;
            }

            var stoppable = true;
            selection.each(function () {
                if (!nfCanvasUtils.isStoppable(d3.select(this))) {
                    stoppable = false;
                    return false;
                }
            });

            return stoppable;
        },

        /**
         * Determines if the component in the specified selection is runnable.
         * 지정된 선택 범위의 구성 요소가 실행 가능한지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection is runnable 선택 항목이 실행 가능한지 여부
         */
        isStoppable: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            if (nfCanvasUtils.isProcessGroup(selection)) {
                return true;
            }

            if (nfCanvasUtils.canOperate(selection) === false) {
                return false;
            }

            var stoppable = false;
            var selectionData = selection.datum();
            if (nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isOutputPort(selection)) {
                stoppable = selectionData.status.aggregateSnapshot.runStatus === 'Running';
            }

            return stoppable;
        },

        /**
         * Filters the specified selection for any components that supports enable.
         * enable를 지원하는 구성 요소에 대해 지정된 선택 항목을 필터링합니다.
         *
         * @argument {selection} selection      The selection
         */
        filterEnable: function (selection) {
            return selection.filter(function (d) {
                var selected = d3.select(this);
                var selectedData = selected.datum();

                // enable always allowed for PGs since they will invoke the /flow endpoint for enabling all applicable components (based on permissions)
                // 사용 가능한 모든 구성 요소 (사용 권한 기반)를 활성화하기 위해 / flow 끝점을 호출하므로 항상 PG에 대해 사용 가능하게 설정합니다.
                if (nfCanvasUtils.isProcessGroup(selected)) {
                    return true;
                }

                // not a PG, verify permissions to modify
                // PG가 아니라 수정 권한을 확인하십시오.
                if (nfCanvasUtils.canOperate(selected) === false) {
                    return false;
                }

                // ensure its a processor, input port, or output port and supports modification and is disabled (can enable) 
                // 프로세서, 입력 포트 또는 출력 포트를 보장하고 수정을 지원하며 비활성화 (활성화 가능)
                return ((nfCanvasUtils.isProcessor(selected) || nfCanvasUtils.isInputPort(selected) || nfCanvasUtils.isOutputPort(selected)) &&
                    nfCanvasUtils.supportsModification(selected) && selectedData.status.aggregateSnapshot.runStatus === 'Disabled');
            });
        },

        /**
         * Determines if the specified selection contains any components that supports enable.
         * 지정된 선택에 enable를 지원하는 컴퍼넌트가 포함 될지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         */
        canEnable: function (selection) {
            if (selection.empty()) {
                return true;
            }

            return nfCanvasUtils.filterEnable(selection).size() === selection.size();
        },

        /**
         * Filters the specified selection for any components that supports disable.
         * disable를 지원하는 구성 요소에 대해 지정된 선택 항목을 필터링합니다.
         *
         * @argument {selection} selection      The selection
         */
        filterDisable: function (selection) {
            return selection.filter(function (d) {
                var selected = d3.select(this);
                var selectedData = selected.datum();

                // disable always allowed for PGs since they will invoke the /flow endpoint for disabling all applicable components (based on permissions)
                // 사용 권한을 기반으로 모든 적용 가능한 구성 요소를 사용하지 않도록 / flow 끝점을 호출하므로 PG에 항상 사용되지 않도록 설정됩니다.
                if (nfCanvasUtils.isProcessGroup(selected)) {
                    return true;
                }

                // not a PG, verify permissions to modify
                // PG가 아니라 수정 권한을 확인하십시오.
                if (nfCanvasUtils.canOperate(selected) === false) {
                    return false;
                }

                // ensure its a processor, input port, or output port and supports modification and is stopped (can disable)
                // 프로세서, 입력 포트 또는 출력 포트를 확인하고 수정을 지원하고 중지 (비활성화 가능)
                return ((nfCanvasUtils.isProcessor(selected) || nfCanvasUtils.isInputPort(selected) || nfCanvasUtils.isOutputPort(selected)) &&
                    nfCanvasUtils.supportsModification(selected) &&
                    (selectedData.status.aggregateSnapshot.runStatus === 'Stopped' || selectedData.status.aggregateSnapshot.runStatus === 'Invalid'));
            });
        },

        /**
         * Determines if the specified selection contains any components that supports disable.
         * 지정된 선택 영역에 disable을 지원하는 구성 요소가 포함되어 있는지 여부를 확인합니다.
         *
         * @argument {selection} selection      The selection
         */
        canDisable: function (selection) {
            if (selection.empty()) {
                return true;
            }

            return nfCanvasUtils.filterDisable(selection).size() === selection.size();
        },


        /**
         * Determines if the specified selection can all start transmitting.
         * 지정된 선택이 모두 전송을 개시 할 수 있을지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection can start transmitting 선택이 전송을 시작할 수 있는지 여부
         */
        canAllStartTransmitting: function (selection) {
            if (selection.empty()) {
                return false;
            }

            var canStartTransmitting = true;
            selection.each(function () {
                if (!nfCanvasUtils.canStartTransmitting(d3.select(this))) {
                    canStartTransmitting = false;
                }
            });
            return canStartTransmitting;
        },

        /**
         * Determines if the specified selection supports starting transmission.
         * 지정된 선택이 전송 시작을 지원하는지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         */
        canStartTransmitting: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            if ((nfCanvasUtils.canModify(selection) === false || nfCanvasUtils.canRead(selection) === false)
                    && nfCanvasUtils.canOperate(selection) === false) {
                return false;
            }

            return nfCanvasUtils.isRemoteProcessGroup(selection);
        },

        /**
         * Determines if the specified selection can all stop transmitting.
         * 지정된 선택 범위가 모두 송신을 정지 할 수 있을지 어떨지를 판별합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}                    Whether the selection can stop transmitting
         */
        canAllStopTransmitting: function (selection) {
            if (selection.empty()) {
                return false;
            }

            var canStopTransmitting = true;
            selection.each(function () {
                if (!nfCanvasUtils.canStopTransmitting(d3.select(this))) {
                    canStopTransmitting = false;
                }
            });
            return canStopTransmitting;
        },

        /**
         * Determines if the specified selection can stop transmission.
         * 지정된 선택이 전송을 정지 할 수 있을지 어떨지를 판정합니다.
         *
         * @argument {selection} selection      The selection
         */
        canStopTransmitting: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            if ((nfCanvasUtils.canModify(selection) === false || nfCanvasUtils.canRead(selection) === false)
                    && nfCanvasUtils.canOperate(selection) === false) {
                return false;
            }

            return nfCanvasUtils.isRemoteProcessGroup(selection);
        },

        /**
         * Determines whether the components in the specified selection are deletable.
         * 지정된 선택 항목의 구성 요소를 삭제할 수 있는지 여부를 결정합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}            Whether the selection is deletable
         */
        areDeletable: function (selection) {
            if (selection.empty()) {
                return false;
            }

            var isDeletable = true;
            selection.each(function () {
                if (!nfCanvasUtils.isDeletable(d3.select(this))) {
                    isDeletable = false;
                }
            });
            return isDeletable;
        },

        /**
         * Determines whether the component in the specified selection is deletable.
         * 지정된 선택 영역의 구성 요소를 삭제할 수 있는지 여부를 결정합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}            Whether the selection is deletable
         */
        isDeletable: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            // ensure the user has write permissions to the current process group
            // 사용자에게 현재 프로세스 그룹에 대한 쓰기 권한이 있는지 확인하십시오.
            if (nfCanvas.canWrite() === false) {
                return false;
            }

            if (nfCanvasUtils.canModify(selection) === false) {
                return false;
            }

            return nfCanvasUtils.supportsModification(selection);
        },

        /**
         * Determines whether the specified selection is configurable.
         * 지정된 선택 항목을 구성 할 수 있는지 여부를 결정합니다.
         *
         * @param selection
         */
        isConfigurable: function (selection) {
            // ensure the correct number of components are selected
            // 올바른 구성 요소 수가 선택되었는지 확인하십시오.
            if (selection.size() !== 1) {
                if (selection.empty()) {
                    return true;
                } else {
                    return false;
                }
            }

            if (nfCanvasUtils.isProcessGroup(selection)) {
                return true;
            }
            if (nfCanvasUtils.canRead(selection) === false || nfCanvasUtils.canModify(selection) === false) {
                return false;
            }
            if (nfCanvasUtils.isFunnel(selection)) {
                return false;
            }

            return nfCanvasUtils.supportsModification(selection);
        },

        /**
         * Determines whether the specified selection has details.
         * 지정된 선택 항목에 세부 정보가 있는지 여부를 확인합니다.
         *
         * @param selection
         */
        hasDetails: function (selection) {
            // ensure the correct number of components are selected
            // 올바른 구성 요소 수가 선택되었는지 확인하십시오.
            if (selection.size() !== 1) {
                return false;
            }

            if (nfCanvasUtils.canRead(selection) === false) {
                return false;
            }
            if (nfCanvasUtils.canModify(selection)) {
                if (nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isOutputPort(selection) || nfCanvasUtils.isRemoteProcessGroup(selection) || nfCanvasUtils.isConnection(selection)) {
                    return !nfCanvasUtils.isConfigurable(selection);
                }
            } else {
                return nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isConnection(selection) || nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isOutputPort(selection) || nfCanvasUtils.isRemoteProcessGroup(selection);
            }

            return false;
        },

        /**
         * Determines whether the user can configure or open the policy management page.
         * 사용자가 정책 관리 페이지를 구성하거나 열 수 있는지 여부를 결정합니다.
         */
        canManagePolicies: function () {
            var selection = nfCanvasUtils.getSelection();

            // ensure 0 or 1 components selected
            if (selection.size() <= 1) {
                // if something is selected, ensure it's not a connection
                if (!selection.empty() && nfCanvasUtils.isConnection(selection)) {
                    return false;
                }

                // ensure access to read tenants
                return nfCommon.canAccessTenants();
            }

            return false;
        },

        /**
         * Determines whether the components in the specified selection are writable.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}            Whether the selection is writable
         */
        canModify: function (selection) {
            var selectionSize = selection.size();
            var writableSize = selection.filter(function (d) {
                return d.permissions.canWrite;
            }).size();

            return selectionSize === writableSize;
        },

        /**
         * Determines whether the components in the specified selection are readable.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}            Whether the selection is readable
         */
        canRead: function (selection) {
            var selectionSize = selection.size();
            var readableSize = selection.filter(function (d) {
                return d.permissions.canRead;
            }).size();

            return selectionSize === readableSize;
        },

        /**
         * Determines whether the components in the specified selection can be operated.
         * 지정된 선택 항목의 구성 요소를 조작 할 수 있는지 여부를 판별합니다.
         *
         * @argument {selection} selection      The selection
         * @return {boolean}            Whether the selection can be operated
         */
        canOperate: function (selection) {
            var selectionSize = selection.size();
            var writableSize = selection.filter(function (d) {
                return d.permissions.canWrite || (d.operatePermissions && d.operatePermissions.canWrite);
            }).size();

            return selectionSize === writableSize;
        },

        /**
         * Determines whether the specified selection is in a state to support modification.
         * 지정된 선택 항목이 수정을 지원할 수있는 상태인지 여부를 확인합니다.
         *
         * @argument {selection} selection      The selection
         */
        supportsModification: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            // get the selection data
            var selectionData = selection.datum();

            var supportsModification = false;
            if (nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isOutputPort(selection)) {
                supportsModification = !(selectionData.status.aggregateSnapshot.runStatus === 'Running' || selectionData.status.aggregateSnapshot.activeThreadCount > 0);
            } else if (nfCanvasUtils.isRemoteProcessGroup(selection)) {
                supportsModification = !(selectionData.status.transmissionStatus === 'Transmitting' || selectionData.status.aggregateSnapshot.activeThreadCount > 0);
            } else if (nfCanvasUtils.isProcessGroup(selection)) {
                supportsModification = true;
            } else if (nfCanvasUtils.isFunnel(selection)) {
                supportsModification = true;
            } else if (nfCanvasUtils.isLabel(selection)) {
                supportsModification = true;
            } else if (nfCanvasUtils.isConnection(selection)) {
                var isSourceConfigurable = false;
                var isDestinationConfigurable = false;

                var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(selectionData);
                var source = d3.select('#id-' + sourceComponentId);
                if (!source.empty()) {
                    if (nfCanvasUtils.isRemoteProcessGroup(source) || nfCanvasUtils.isProcessGroup(source)) {
                        isSourceConfigurable = true;
                    } else {
                        isSourceConfigurable = nfCanvasUtils.supportsModification(source);
                    }
                }

                var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(selectionData);
                var destination = d3.select('#id-' + destinationComponentId);
                if (!destination.empty()) {
                    if (nfCanvasUtils.isRemoteProcessGroup(destination) || nfCanvasUtils.isProcessGroup(destination)) {
                        isDestinationConfigurable = true;
                    } else {
                        isDestinationConfigurable = nfCanvasUtils.supportsModification(destination);
                    }
                }

                supportsModification = isSourceConfigurable && isDestinationConfigurable;
            }
            return supportsModification;
        },

        /**
         * Determines the connectable type for the specified source selection.
         * 지정한 소스 선택에 대한 연결 가능 유형을 결정합니다.
         *
         * @argument {selection} selection      The selection
         */
        getConnectableTypeForSource: function (selection) {
            var type;
            if (nfCanvasUtils.isProcessor(selection)) {
                type = 'PROCESSOR';
            } else if (nfCanvasUtils.isRemoteProcessGroup(selection)) {
                type = 'REMOTE_OUTPUT_PORT';
            } else if (nfCanvasUtils.isProcessGroup(selection)) {
                type = 'OUTPUT_PORT';
            } else if (nfCanvasUtils.isInputPort(selection)) {
                type = 'INPUT_PORT';
            } else if (nfCanvasUtils.isFunnel(selection)) {
                type = 'FUNNEL';
            }
            return type;
        },

        /**
         * Determines the connectable type for the specified destination selection.
         * 지정된 대상 선택에 대한 연결 가능 유형을 결정합니다.
         *
         * @argument {selection} selection      The selection
         */
        getConnectableTypeForDestination: function (selection) {
            var type;
            if (nfCanvasUtils.isProcessor(selection)) {
                type = 'PROCESSOR';
            } else if (nfCanvasUtils.isRemoteProcessGroup(selection)) {
                type = 'REMOTE_INPUT_PORT';
            } else if (nfCanvasUtils.isProcessGroup(selection)) {
                type = 'INPUT_PORT';
            } else if (nfCanvasUtils.isOutputPort(selection)) {
                type = 'OUTPUT_PORT';
            } else if (nfCanvasUtils.isFunnel(selection)) {
                type = 'FUNNEL';
            }
            return type;
        },

        /**
         * Determines if the graph is currently in a state to copy.
         * 그래프가 현재 복사할 상태에 있는지 여부를 결정한다.
         *
         * @argument {selection} selection    The selection
         */
        isCopyable: function (selection) {
            // if nothing is selected return
            // 아무것도 선택되지 않은 경우 return
            if (selection.empty()) {
                return false;
            }

            if (nfCanvasUtils.canRead(selection) === false) {
                return false;
            }

            // determine how many copyable components are selected
            // 선택할 수있는 복사 가능 구성 요소 수 결정
            var copyable = selection.filter(function (d) {
                var selected = d3.select(this);
                if (nfCanvasUtils.isConnection(selected)) {
                    var sourceIncluded = !selection.filter(function (source) {
                        var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(d);
                        return sourceComponentId === source.id;
                    }).empty();
                    var destinationIncluded = !selection.filter(function (destination) {
                        var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(d);
                        return destinationComponentId === destination.id;
                    }).empty();
                    return sourceIncluded && destinationIncluded;
                } else {
                    return nfCanvasUtils.isProcessor(selected) || nfCanvasUtils.isFunnel(selected) || nfCanvasUtils.isLabel(selected) || nfCanvasUtils.isProcessGroup(selected) || nfCanvasUtils.isRemoteProcessGroup(selected) || nfCanvasUtils.isInputPort(selected) || nfCanvasUtils.isOutputPort(selected);
                }
            });

            // ensure everything selected is copyable
            // 선택한 모든 것이 복사 가능한지 확인하십시오.
            return selection.size() === copyable.size();
        },

        /**
         * Determines if something is currently pastable.
         * 현재 붙여 넣을 수있는 항목을 결정합니다.
         */
        isPastable: function () {
            return nfCanvas.canWrite() && nfClipboard.isCopied();
        },

        /**
         * Persists the current user view.
         * 현재 사용자보기를 유지합니다.
         */
        persistUserView: function () {
            var name = config.storage.namePrefix + nfCanvas.getGroupId();

            // create the item to store
            // 저장할 항목 만들기
            var translate = nfCanvas.View.getTranslate();
            var item = {
                scale: nfCanvas.View.getScale(),
                translateX: translate[0],
                translateY: translate[1]
            };

            // store the item
            nfStorage.setItem(name, item);
        },

        /**
         * Gets the name for this connection.
         * 이 연결의 이름을 가져옵니다.
         *
         * @param {object} connection
         */
        formatConnectionName: function (connection) {
            if (!nfCommon.isBlank(connection.name)) {
                return connection.name;
            } else if (nfCommon.isDefinedAndNotNull(connection.selectedRelationships)) {
                return connection.selectedRelationships.join(', ');
            }
            return '';
        },

        /**
         * Reloads a connection's source and destination.
         * 연결의 소스와 대상을 다시로드합니다.
         *
         * @param {string} sourceComponentId          The connection source id
         * @param {string} destinationComponentId     The connection destination id
         */
        reloadConnectionSourceAndDestination: function (sourceComponentId, destinationComponentId) {
            if (nfCommon.isBlank(sourceComponentId) === false) {
                var source = d3.select('#id-' + sourceComponentId);
                if (source.empty() === false) {
                    nfGraph.reload(source);
                }
            }
            if (nfCommon.isBlank(destinationComponentId) === false) {
                var destination = d3.select('#id-' + destinationComponentId);
                if (destination.empty() === false) {
                    nfGraph.reload(destination);
                }
            }
        },

        /**
         * Returns the component id of the source of this processor. If the connection is attached
         * to a port in a [sub|remote] group, the component id will be that of the group. Otherwise
         * it is the component itself.
         * 이 프로세서의 소스의 컴퍼넌트 ID를 돌려줍니다. 연결이 [sub | remote] 그룹의 포트에 연결되면 구성 요소 ID는 그룹의 ID가됩니다. 그렇지 않으면 구성 요소 자체입니다.
         *
         * @param {object} connection   The connection in question 문제의 연결
         */
        getConnectionSourceComponentId: function (connection) {
            var sourceId = connection.sourceId;
            if (connection.sourceGroupId !== nfCanvas.getGroupId()) {
                sourceId = connection.sourceGroupId;
            }
            return sourceId;
        },

        /**
         * Returns the component id of the source of this processor. If the connection is attached
         * to a port in a [sub|remote] group, the component id will be that of the group. Otherwise
         * it is the component itself.
         * 이 프로세서의 소스의 컴퍼넌트 ID를 돌려줍니다. 연결이 [sub | remote] 그룹의 포트에 연결되면 구성 요소 ID는 그룹의 ID가됩니다. 그렇지 않으면 구성 요소 자체입니다.
         *
         * @param {object} connection   The connection in question
         */
        getConnectionDestinationComponentId: function (connection) {
            var destinationId = connection.destinationId;
            if (connection.destinationGroupId !== nfCanvas.getGroupId()) {
                destinationId = connection.destinationGroupId;
            }
            return destinationId;
        },

        /**
         * Attempts to restore a persisted view. Returns a flag that indicates if the
         * view was restored.
         * 지속 된 뷰를 복원하려고 시도합니다. 뷰가 복원되었는지를 나타내는 플래그를 리턴합니다.
         */
        restoreUserView: function () {
            var viewRestored = false;

            try {
                // see if we can restore the view position from storage
                // 저장 위치에서 뷰 위치를 복원 할 수 있는지 확인하십시오.
                var name = config.storage.namePrefix + nfCanvas.getGroupId();
                var item = nfStorage.getItem(name);

                // ensure the item is valid
                // 항목이 유효한지 확인하십시오.
                if (nfCommon.isDefinedAndNotNull(item)) {
                    if (isFinite(item.scale) && isFinite(item.translateX) && isFinite(item.translateY)) {
                        // restore previous view
                        // 이전보기 복원
                        nfCanvas.View.transform([item.translateX, item.translateY], item.scale);

                        // mark the view was restore
                        // 보기가 복원되었음을 표시
                        viewRestored = true;
                    }
                }
            } catch (e) {
                // likely could not parse item.. ignoring
            }

            return viewRestored;
        },

        /**
         * Gets the origin of the bounding box for the specified selection.
         * 지정된 선택 영역에 대한 경계 상자의 원점을 가져옵니다.
         *
         * @argument {selection} selection      The selection
         */
        getOrigin: function (selection) {
            var origin = {};

            selection.each(function (d) {
                var selected = d3.select(this);
                if (!nfCanvasUtils.isConnection(selected)) {
                    if (nfCommon.isUndefined(origin.x) || d.position.x < origin.x) {
                        origin.x = d.position.x;
                    }
                    if (nfCommon.isUndefined(origin.y) || d.position.y < origin.y) {
                        origin.y = d.position.y;
                    }
                }
            });

            return origin;
        },

        /**
         * Get a BoundingClientRect, normalized to the canvas, that encompasses all nodes in a given selection.
         * 주어진 선택의 모든 노드를 포함하는 캔버스로 표준화 된 BoundingClientRect를 가져옵니다.
         *
         * @param selection
         * @returns {*} BoundingClientRect
         */
        getSelectionBoundingClientRect: function (selection) {
            var scale = nfCanvas.View.getScale();
            var translate = nfCanvas.View.getTranslate();

            var initialBBox = {
                x: Number.MAX_VALUE,
                y: Number.MAX_VALUE,
                right: Number.MIN_VALUE,
                bottom: Number.MIN_VALUE,
                translate: nfCanvas.View.getTranslate()
            };

            var bbox = selection.nodes().reduce(function (aggregateBBox, node) {
                var rect = node.getBoundingClientRect();
                aggregateBBox.x = Math.min(rect.x, aggregateBBox.x);
                aggregateBBox.y = Math.min(rect.y, aggregateBBox.y);
                aggregateBBox.right = Math.max(rect.right, aggregateBBox.right);
                aggregateBBox.bottom = Math.max(rect.bottom, aggregateBBox.bottom);

                return aggregateBBox;
            }, initialBBox);

            // normalize the bounding box with scale and translate
            // 스케일로 경계 상자를 정규화하고 번역하십시오.
            bbox.x = (bbox.x - translate[0]) / scale;
            bbox.y = (bbox.y - translate[1]) / scale;
            bbox.right = (bbox.right - translate[0]) / scale;
            bbox.bottom = (bbox.bottom - translate[1]) / scale;

            bbox.width = bbox.right - bbox.x;
            bbox.height = bbox.bottom - bbox.y;
            bbox.top = bbox.y;
            bbox.left = bbox.x;

            return bbox;
        },

        /**
         * Applies a translation to BoundingClientRect.
         * BoundingClientRect에 번역 적용
         *
         * @param boundingClientRect
         * @param translate
         * @returns {{top: number, left: number, bottom: number, x: number, width: number, y: number, right: number, height: number}}
         */
        translateBoundingClientRect: function (boundingClientRect, translate) {
            if (nfCommon.isUndefinedOrNull(translate)) {
                if (nfCommon.isDefinedAndNotNull(boundingClientRect.translate)) {
                    translate = boundingClientRect.translate;
                } else {
                    translate = nfCanvas.View.getTranslate();
                }
            }
            return {
                x: boundingClientRect.x - translate[0],
                y: boundingClientRect.y - translate[1],
                left: boundingClientRect.left - translate[0],
                right: boundingClientRect.right - translate[0],
                top: boundingClientRect.top - translate[1],
                bottom: boundingClientRect.bottom - translate[1],
                width: boundingClientRect.width,
                height: boundingClientRect.height
            }
        },

        /**
         * Moves the specified components into the current parent group.
         * 지정된 구성 요소를 현재 상위 그룹으로 이동합니다.
         *
         * @param {selection} components
         */
        moveComponentsToParent: function (components) {
            var groupId = nfCanvas.getParentGroupId();

            // if the group id is null, we're already in the top most group
            if (groupId === null) {
                nfDialog.showOkDialog({
                    headerText: 'Process Group',
                    dialogContent: 'Components are already in the topmost group.'
                });
            } else {
                moveComponents(components, groupId);
            }
        },

        /**
         * Moves the specified components into the specified group.
         *
         * @param {selection} components    The components to move
         * @param {selection} group         The destination group
         */
        moveComponents: function (components, group) {
            var groupData = group.datum();

            // move the components into the destination and...
            moveComponents(components, groupData.id).done(function () {
                // reload the target group
                nfCanvasUtils.getComponentByType('ProcessGroup').reload(groupData.id);
            });
        },

        /**
         * Removes any dangling edges. All components are retained as well as any
         * edges whose source and destination are also retained.
         * 매달려있는 모서리를 제거합니다. 모든 구성 요소뿐만 아니라 소스와 대상도 유지되는 모서리가 유지됩니다.
         *
         * @param {selection} selection
         * @returns {array}
         */
        trimDanglingEdges: function (selection) {
            // returns whether the source and destination of the specified connection are present in the specified selection
            // 지정된 연결의 소스와 대상이 지정된 선택 항목에 있는지 여부를 반환합니다.
            var keepConnection = function (connection) {
                var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(connection);
                var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(connection);

                // determine if both source and destination are selected
                // 출발지와 목적지가 모두 선택되었는지 확인
                var includesSource = false;
                var includesDestination = false;
                selection.each(function (d) {
                    if (d.id === sourceComponentId) {
                        includesSource = true;
                    }
                    if (d.id === destinationComponentId) {
                        includesDestination = true;
                    }
                });

                return includesSource && includesDestination;
            };

            // include all components and connections whose source/destination are also selected
            // 소스 / 대상이 선택된 모든 구성 요소 및 연결 포함
            return selection.filter(function (d) {
                if (d.type === 'Connection') {
                    return keepConnection(d);
                } else {
                    return true;
                }
            });
        },

        /**
         * Determines if the component in the specified selection is a valid connection source.
         * 지정된 선택 항목의 구성 요소가 유효한 연결 소스인지 여부를 확인합니다.
         *
         * @param {selection} selection         The selection
         * @return {boolean} Whether the selection is a valid connection source 선택이 유효한 연결 소스인지 여부
         */
        isValidConnectionSource: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            // always allow connections from process groups
            // 프로세스 그룹의 연결을 항상 허용
            if (nfCanvasUtils.isProcessGroup(selection)) {
                return true;
            }

            // require read and write for a connection source since we'll need to read the source to obtain valid relationships, etc
            // 유효한 관계를 얻기 위해 소스를 읽을 필요가 있기 때문에 연결 소스에 대한 읽기 및 쓰기가 필요합니다.
            if (nfCanvasUtils.canRead(selection) === false || nfCanvasUtils.canModify(selection) === false) {
                return false;
            }

            return nfCanvasUtils.isProcessor(selection) || nfCanvasUtils.isRemoteProcessGroup(selection) ||
                nfCanvasUtils.isInputPort(selection) || nfCanvasUtils.isFunnel(selection);
        },

        /**
         * Determines if the component in the specified selection is a valid connection destination.
         * 지정된 선택 항목의 구성 요소가 유효한 연결 대상인지 여부를 확인합니다.
         *
         * @param {selection} selection         The selection
         * @return {boolean} Whether the selection is a valid connection destination 선택 항목이 유효한 연결 대상인지 여부
         */
        isValidConnectionDestination: function (selection) {
            if (selection.size() !== 1) {
                return false;
            }

            if (nfCanvasUtils.isProcessGroup(selection)) {
                return true;
            }

            // require write for a connection destination 
            // 연결 목적지에 쓰기를 요구한다.
            if (nfCanvasUtils.canModify(selection) === false) {
                return false;
            }

            if (nfCanvasUtils.isRemoteProcessGroup(selection) || nfCanvasUtils.isOutputPort(selection) || nfCanvasUtils.isFunnel(selection)) {
                return true;
            }

            // if processor, ensure it supports input
            // 프로세서 인 경우 입력을 지원하는지 확인하십시오.
            if (nfCanvasUtils.isProcessor(selection)) {
                var destinationData = selection.datum();
                return destinationData.inputRequirement !== 'INPUT_FORBIDDEN';
            }
        },

        /**
         * Returns whether the authorizer is managed.
         */
        isManagedAuthorizer: function () {
            return nfCanvas.isManagedAuthorizer();
        },

        /**
         * Returns whether the authorizer is configurable.
         */
        isConfigurableAuthorizer: function () {
            return nfCanvas.isConfigurableAuthorizer();
        },

        /**
         * Returns whether the authorizer support configurable users and groups.
         */
        isConfigurableUsersAndGroups: function () {
            return nfCanvas.isConfigurableUsersAndGroups();
        },

        /**
         * Adds the restricted usage and the required permissions.
         *
         * @param additionalRestrictedUsages
         * @param additionalRequiredPermissions
         */
        addComponentRestrictions: function (additionalRestrictedUsages, additionalRequiredPermissions) {
            additionalRestrictedUsages.each(function (componentRestrictions, requiredPermissionId) {
                if (!restrictedUsage.has(requiredPermissionId)) {
                    restrictedUsage.set(requiredPermissionId, []);
                }

                componentRestrictions.forEach(function (componentRestriction) {
                    restrictedUsage.get(requiredPermissionId).push(componentRestriction);
                });
            });
            additionalRequiredPermissions.each(function (requiredPermissionLabel, requiredPermissionId) {
                if (!requiredPermissions.has(requiredPermissionId)) {
                    requiredPermissions.set(requiredPermissionId, requiredPermissionLabel);
                }
            });
        },

        /**
         * Gets the component restrictions and the require permissions.
         *
         * @returns {{restrictedUsage: map, requiredPermissions: map}} component restrictions
         */
        getComponentRestrictions: function () {
            return {
                restrictedUsage: restrictedUsage,
                requiredPermissions: requiredPermissions
            };
        },

        /**
         * Set the group id.
         *
         * @argument {string} gi       The group id
         */
        setGroupId: function (gi) {
            return nfCanvas.setGroupId(gi);
        },

        /**
         * Get the group id.
         */
        getGroupId: function () {
            return nfCanvas.getGroupId();
        },

        /**
         * Get the group name.
         */
        getGroupName: function () {
            return nfCanvas.getGroupName();
        },

        /**
         * Get the parent group id.
         */
        getParentGroupId: function () {
            return nfCanvas.getParentGroupId();
        },

        /**
         * Reloads the status for the entire canvas (components and flow.)
         * 전체 캔버스의 상태를 다시로드합니다 (구성 요소 및 흐름).
         *
         * @param {string} groupId    Optional, specific group id to reload the canvas to
         */
        reload: function (groupId) {
            return nfCanvas.reload({
                'transition': true
            }, groupId);
        },

        /**
         * Whether the current user can read from this group.
         *
         * @returns {boolean}   can write
         */
        canReadCurrentGroup: function () {
            return nfCanvas.canRead();
        },

        /**
         * Whether the current user can write in this group.
         *
         * @returns {boolean}   can write
         */
        canWriteCurrentGroup: function () {
            return nfCanvas.canWrite();
        },

        /**
         * Gets the current scale.
         * 현재의 눈금을 가져옵니다.
         */
        getCanvasScale: function () {
            return nfCanvas.View.getScale();
        },

        /**
         * Gets the current translation.
         * 현재 번역을 가져온다.
         */
        getCanvasTranslate: function () {
            return nfCanvas.View.getTranslate();
        },

        /**
         * Translate the canvas by the specified [x, y]
         * 캔버스를 지정된 [x, y]로 번역하십시오.
         *
         * @param {array} translate     [x, y] to translate by
         */
        translateCanvas: function (translate) {
            nfCanvas.View.translate(translate);
        },

        /**
         * Zooms to fit the entire graph on the canvas.
         * 캔버스에서 전체 그래프를 확대 / 축소합니다.
         */
        fitCanvas: function () {
            return nfCanvas.View.fit();
        },

        /**
         * Zooms in a single zoom increment.
         * 단일 줌 단위로 확대 / 축소합니다.
         */
        zoomInCanvas: function () {
            return nfCanvas.View.zoomIn();
        },

        /**
         * Zooms out a single zoom increment.
         * 단일 확대 / 축소 증감을 축소합니다.
         */
        zoomOutCanvas: function () {
            return nfCanvas.View.zoomOut();
        },

        /**
         * Zooms to the actual size (1 to 1).
         * 실제 크기 (1 : 1)로 확대합니다.
         */
        actualSizeCanvas: function () {
            return nfCanvas.View.actualSize();
        },

        /**
         * Whether or not a component should be rendered based solely on the current scale.
         * 컴퍼넌트가 현재의 스케일에만 근거 해 렌더링되어야할지 어떨지
         *
         * @returns {Boolean}
         */
        shouldRenderPerScale: function () {
            return nfCanvas.View.shouldRenderPerScale();
        },

        /**
         * Gets the canvas offset.
         */
        getCanvasOffset: function () {
            return nfCanvas.CANVAS_OFFSET;
        }
    };
    return nfCanvasUtils;
}));