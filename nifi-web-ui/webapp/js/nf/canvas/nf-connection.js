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
        define(['jquery',
                'd3',
                'nf.Common',
                'nf.Dialog',
                'nf.Storage',
                'nf.ErrorHandler',
                'nf.Client',
                'nf.CanvasUtils'],
            function ($, d3, nfCommon, nfDialog, nfStorage, nfErrorHandler, nfClient, nfCanvasUtils) {
                return (nf.Connection = factory($, d3, nfCommon, nfDialog, nfStorage, nfErrorHandler, nfClient, nfCanvasUtils));
            });
    } else if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = (nf.Connection =
            factory(require('jquery'),
                require('d3'),
                require('nf.Common'),
                require('nf.Dialog'),
                require('nf.Storage'),
                require('nf.ErrorHandler'),
                require('nf.Client'),
                require('nf.CanvasUtils')));
    } else {
        nf.Connection = factory(root.$,
            root.d3,
            root.nf.Common,
            root.nf.Dialog,
            root.nf.Storage,
            root.nf.ErrorHandler,
            root.nf.Client,
            root.nf.CanvasUtils);
    }
}(this, function ($, d3, nfCommon, nfDialog, nfStorage, nfErrorHandler, nfClient, nfCanvasUtils) {
    'use strict';

    var nfSelectable;
    var nfConnectionConfiguration;
    var nfQuickSelect;
    var nfContextMenu;

    // the dimensions for the connection label
    // 연결 레이블의 치수
    var dimensions = {
        width: 224
    };

    // width of a backpressure indicator - half of width, left/right padding, left/right border
    var backpressureBarWidth = (dimensions.width / 2) - 15 - 2;

    // --------------------------
    // Snap alignment for drag events
    // 드래그 이벤트에 대한 스냅 선형
    // --------------------------
    var snapAlignmentPixels = 8;
    var snapEnabled = true;

    /**
     * Gets the position of the label for the specified connection.
     * 지정된 연결에 대한 레이블의 위치를 가져옵니다.
     *
     * @param {type} connectionLabel      The connection label
     */
    var getLabelPosition = function (connectionLabel) {
        var d = connectionLabel.datum();

        var x, y;
        if (d.bends.length > 0) {
            var i = Math.min(Math.max(0, d.labelIndex), d.bends.length - 1);
            x = d.bends[i].x;
            y = d.bends[i].y;
        } else {
            x = (d.start.x + d.end.x) / 2;
            y = (d.start.y + d.end.y) / 2;
        }

        // offset to account for the label dimensions
        // 라벨 크기를 고려하여 오프셋
        x -= (dimensions.width / 2);
        y -= (connectionLabel.attr('height') / 2);

        return {
            x: x,
            y: y
        };
    };

    // ----------------------------------
    // connections currently on the graph
    // 현재 그래프에 있는 연결
    // ----------------------------------

    var connectionMap;

    // -----------------------------------------------------------
    // cache for components that are added/removed from the canvas
    // 캔버스에서 추가/제거되는 구성 요소의 캐시
    // -----------------------------------------------------------

    var removedCache;
    var addedCache;

    // ---------------------
    // connection containers
    // ---------------------

    var connectionContainer;

    // ------------------------
    // line point drag behavior
    // 선 점 드래그 동작
    // ------------------------

    var bendPointDrag;
    var endpointDrag;

    // ------------------------------
    // connection label drag behavior
    // 연결 레이블 드래그 동작
    // ------------------------------

    var labelDrag;

    // function for generating lines
    // 선을 생성하는 함수
    var lineGenerator;

    // --------------------------
    // privately scoped functions
    // 개인적으로 범위가 지정된 함수
    // --------------------------

    /**
     * Calculates the distance between the two points specified squared.
     * 지정된 두 점 사이의 거리를 제곱 계산합니다.
     *
     * @param {object} v        First point
     * @param {object} w        Second point
     */
    var distanceSquared = function (v, w) {
        return Math.pow(v.x - w.x, 2) + Math.pow(v.y - w.y, 2);
    };

    /**
     * Calculates the distance between the two points specified.
     * 지정된 두 점 사이의 거리를 계산합니다.
     *
     * @param {object} v        First point
     * @param {object} w        Second point
     */
    var distanceBetweenPoints = function (v, w) {
        return Math.sqrt(distanceSquared(v, w));
    };

    /**
     * Calculates the distance between the point and the line created by s1 and s2.
     * 점과 s1과 s2에 의해 생성 된 선 사이의 거리를 계산합니다.
     *
     * @param {object} p            The point
     * @param {object} s1           Segment start
     * @param {object} s2           Segment end
     */
    var distanceToSegment = function (p, s1, s2) {
        var l2 = distanceSquared(s1, s2);
        if (l2 === 0) {
            return Math.sqrt(distanceSquared(p, s1));
        }

        var t = ((p.x - s1.x) * (s2.x - s1.x) + (p.y - s1.y) * (s2.y - s1.y)) / l2;
        if (t < 0) {
            return Math.sqrt(distanceSquared(p, s1));
        }
        if (t > 1) {
            return Math.sqrt(distanceSquared(p, s2));
        }

        return Math.sqrt(distanceSquared(p, {
            'x': s1.x + t * (s2.x - s1.x),
            'y': s1.y + t * (s2.y - s1.y)
        }));
    };

    /**
     * Calculates the index of the bend point that is nearest to the specified point.
     * 지정된 점에 가장 가까운 굽힘 점의 인덱스를 계산합니다.
     *
     * @param {object} p
     * @param {object} connectionData
     */
    var getNearestSegment = function (p, connectionData) {
        if (connectionData.bends.length === 0) {
            return 0;
        }

        var minimumDistance;
        var index;

        // line is comprised of start -> [bends] -> end
        // line은 start -> [bends] -> end로 구성됩니다.
        var line = [connectionData.start].concat(connectionData.bends, [connectionData.end]);

        // consider each segment
        // 각 세그먼트를 고려하십시오.
        for (var i = 0; i < line.length; i++) {
            if (i + 1 < line.length) {
                var distance = distanceToSegment(p, line[i], line[i + 1]);
                if (nfCommon.isUndefined(minimumDistance) || distance < minimumDistance) {
                    minimumDistance = distance;
                    index = i;
                }
            }
        }

        return index;
    };

    /**
     * Determines if the specified type is a type of input port.
     * 지정된 형태가 입력 포트의 형태 일지 어떨지를 판정합니다.
     *
     * @argument {string} type      The port type
     */
    var isInputPortType = function (type) {
        return type.indexOf('INPUT_PORT') >= 0;
    };

    /**
     * Determines if the specified type is a type of output port.
     * 지정된 형태가 출력 포트의 형태 일지 어떨지를 판정합니다.
     *
     * @argument {string} type      The port type
     */
    var isOutputPortType = function (type) {
        return type.indexOf('OUTPUT_PORT') >= 0;
    };

    /**
     * Determines whether the terminal of the connection (source|destination) is
     * a group.
     * 연결의 터미널 (소스 | 대상)이 그룹인지 여부를 결정합니다.
     *
     * @param {object} terminal
     */
    var isGroup = function (terminal) {
        return terminal.groupId !== nfCanvasUtils.getGroupId() && (isInputPortType(terminal.type) || isOutputPortType(terminal.type));
    };

    /**
     * Determines whether expiration is configured for the specified connection.
     * 지정한 연결에 대해 만료가 구성되는지 여부를 결정합니다.
     *
     * @param {object} connection
     * @return {boolean} Whether expiration is configured 만료 설정 여부
     */
    var isExpirationConfigured = function (connection) {
        if (nfCommon.isDefinedAndNotNull(connection.flowFileExpiration)) {
            var match = connection.flowFileExpiration.match(/^(\d+).*/);
            if (match !== null && match.length > 0) {
                if (parseInt(match[0], 10) > 0) {
                    return true;
                }
            }
        }
        return false;
    };

    /**
     * Determines whether load-balance is configured for the specified connection.
     * 로드 균형이 지정된 연결에 대해 구성되는지 여부를 결정합니다.
     *
     * @param {object} connection
     * @return {boolean} Whether load-balance is configured 로드 밸런싱 구성 여부
     */
    var isLoadBalanceConfigured = function (connection) {
        return nfCommon.isDefinedAndNotNull(connection.loadBalanceStrategy) && 'DO_NOT_LOAD_BALANCE' !== connection.loadBalanceStrategy;
    };

    /**
     * Sorts the specified connections according to the z index.
     * 지정된 색인을 z 색인에 따라 정렬합니다.
     *
     * @param {type} connections
     */
    var sort = function (connections) {
        connections.sort(function (a, b) {
            return a.zIndex === b.zIndex ? 0 : a.zIndex > b.zIndex ? 1 : -1;
        });
    };

    /**
     * Selects the connection elements against the current connection map.
     * 현재 연결 맵에 대한 연결 요소를 선택합니다.
     */
    var select = function () {
        return connectionContainer.selectAll('g.connection').data(connectionMap.values(), function (d) {
            return d.id;
        });
    };

    /**
     * Renders the connections in the specified selection.
     * 지정된 선택사항의 연결을 렌더링합니다.
     *
     * @param {selection} entered           The selection of connections to be rendered 렌더링할 연결 선택
     * @param {boolean} selected             Whether the element should be selected 요소를 선택해야 하는지 여부를 지정합니다
     * @return the entered selection
     */
    var renderConnections = function (entered, selected) {
        if (entered.empty()) {
            return entered;
        }

        var connection = entered.append('g')
            .attrs({
                'id': function (d) {
                    return 'id-' + d.id;a
                },
                'class': 'connection'
            })
            .classed('selected', selected);

        // create a connection between the two components 
        // 두 구성 요소 사이에 연결고리를 만들다.
        connection.append('path')
            .attrs({
                'class': 'connection-path',
                'pointer-events': 'none'
            });

        // path to show when selection
        // 선택시 표시할 경로
        connection.append('path')
            .attrs({
                'class': 'connection-selection-path',
                'pointer-events': 'none'
            });

        // path to make selection easier
        // 선택하기 쉬운 경로
        connection.append('path')
            .attrs({
                'class': 'connection-path-selectable',
                'pointer-events': 'stroke'
            })
            .on('mousedown.selection', function () {
                // select the connection when clicking the selectable path
                // 선택 가능한 경로를 클릭할 때 연결을 선택합니다
                nfSelectable.select(d3.select(this.parentNode));

                // update URL deep linking params
                // URL 깊은 연결 매개 변수 업데이트
                nfCanvasUtils.setURLParameters();
            })
            .call(nfContextMenu.activate);

        return connection;
    };

    // determines whether the specified connection contains an unsupported relationship
    // 지정된 연결에 지원되지 않는 관계가 있는지 여부를 확인합니다.
    var hasUnavailableRelationship = function (d) {
        var unavailable = false;

        // verify each selected relationship is still available
        // 선택한 각 관계가 여전히 사용 가능한지 확인하십시오.
        if (nfCommon.isDefinedAndNotNull(d.component.selectedRelationships) && nfCommon.isDefinedAndNotNull(d.component.availableRelationships)) {
            $.each(d.component.selectedRelationships, function (_, selectedRelationship) {
                if ($.inArray(selectedRelationship, d.component.availableRelationships) === -1) {
                    unavailable = true;
                    return false;
                }
            });
        }

        return unavailable;
    };

    // gets the appropriate end marker
    // 적절한 끝 마커를 얻는다.
    var getEndMarker = function (d) {
        var marker = 'normal';

        if (d.permissions.canRead) {
            // if the connection has a relationship that is unavailable, mark it a ghost relationship
            // 연결에 사용할 수없는 관계가있는 경우 유령 관계로 표시합니다.
            if (isFullBytes(d) || isFullCount(d)) {
                marker = 'full';
            } else if (hasUnavailableRelationship(d)) {
                marker = 'ghost';
            }
        } else {
            marker = 'unauthorized';
        }

        return 'url(#' + marker + ')';
    };

    // gets the appropriate drop shadow
    // 적절한 그림자를 얻는다.
    var getDropShadow = function (d) {
        if (isFullCount(d) || isFullBytes(d)) {
            return 'url(#connection-full-drop-shadow)';
        } else {
            return 'url(#component-drop-shadow)';
        }
    };

    // determines whether the connection is full based on the object count threshold
    // 개체 수 임계 값을 기준으로 연결이 가득 찼는 지 여부를 확인합니다.
    var isFullCount = function (d) {
        return d.status.aggregateSnapshot.percentUseCount === 100;
    };

    // determines whether the connection is in warning based on the object count threshold
    var isWarningCount = function (d) {
        var percentUseCount = d.status.aggregateSnapshot.percentUseCount;
        if (nfCommon.isDefinedAndNotNull(percentUseCount)) {
            return percentUseCount >= 61 && percentUseCount <= 85;
        }

        return false;
    };

    // determines whether the connection is in error based on the object count threshold
    // 객체 수 임계 값에 따라 연결이 경고 상태인지 여부를 결정합니다.
    var isErrorCount = function (d) {
        var percentUseCount = d.status.aggregateSnapshot.percentUseCount;
        if (nfCommon.isDefinedAndNotNull(percentUseCount)) {
            return percentUseCount > 85;
        }

        return false;
    };

    // determines whether the connection is full based on the data size threshold
    // 데이터 크기 임계 값을 기반으로 연결이 가득 찼는 지 여부를 확인합니다.
    var isFullBytes = function (d) {
        return d.status.aggregateSnapshot.percentUseBytes === 100
    };

    // determines whether the connection is in warning based on the data size threshold
    // 데이터 크기 임계 값에 따라 연결이 경고 상태인지 여부를 결정합니다.
    var isWarningBytes = function (d) {
        var percentUseBytes = d.status.aggregateSnapshot.percentUseBytes;
        if (nfCommon.isDefinedAndNotNull(percentUseBytes)) {
            return percentUseBytes >= 61 && percentUseBytes <= 85;
        }

        return false;
    };

    // determines whether the connection is in error based on the data size threshold
    // 데이터 크기 임계 값에 따라 연결에 오류가 있는지 여부를 확인합니다.
    var isErrorBytes = function (d) {
        var percentUseBytes = d.status.aggregateSnapshot.percentUseBytes;
        if (nfCommon.isDefinedAndNotNull(percentUseBytes)) {
            return percentUseBytes > 85;
        }

        return false;
    };

    // updates the specified connections
    // 지정된 연결 업데이트
    var updateConnections = function (updated, options) {
        if (updated.empty()) {
            return;
        }

        var updatePath = true;
        var updateLabel = true;
        var transition = false;

        // extract the options if specified
        // 지정된 경우 옵션을 추출합니다.
        if (nfCommon.isDefinedAndNotNull(options)) {
            updatePath = nfCommon.isDefinedAndNotNull(options.updatePath) ? options.updatePath : updatePath;
            updateLabel = nfCommon.isDefinedAndNotNull(options.updateLabel) ? options.updateLabel : updateLabel;
            transition = nfCommon.isDefinedAndNotNull(options.transition) ? options.transition : transition;
        }

        if (updatePath === true) {
            updated
                .classed('grouped', function (d) {
                    var grouped = false;

                    if (d.permissions.canRead) {
                        // if there are more than one selected relationship, mark this as grouped
                        // 선택한 관계가 두 개 이상인 경우이를 그룹화 된 것으로 표시합니다.
                        if (nfCommon.isDefinedAndNotNull(d.component.selectedRelationships) && d.component.selectedRelationships.length > 1) {
                            grouped = true;
                        }
                    }

                    return grouped;
                })
                .classed('ghost', function (d) {
                    var ghost = false;

                    if (d.permissions.canRead) {
                        // if the connection has a relationship that is unavailable, mark it a ghost relationship
                        // 연결에 사용할 수없는 관계가있는 경우 유령 관계로 표시합니다.
                        if (hasUnavailableRelationship(d)) {
                            ghost = true;
                        }
                    }

                    return ghost;
                });

            // update connection path
            // 연결 경로 업데이트
            updated.select('path.connection-path')
                .classed('unauthorized', function (d) {
                    return d.permissions.canRead === false;
                });

            // update connection behavior
            // 연결 동작을 업데이트합니다.
            updated.select('path.connection-path-selectable')
                .on('dblclick', function (d) {
                    if (d.permissions.canWrite && d.permissions.canRead) {
                        var position = d3.mouse(this.parentNode);

                        // find where to put this bend point
                        //이 굴곡 점을 넣을 위치를 찾습니다.
                        var bendIndex = getNearestSegment({
                            'x': position[0],
                            'y': position[1]
                        }, d);

                        // copy the original to restore if necessary
                        // 필요한 경우 원본을 복사하여 복원합니다.
                        var bends = d.component.bends.slice();

                        // add it to the collection of points
                        // 그것을 포인트 콜렉션에 추가한다.
                        bends.splice(bendIndex, 0, {
                            'x': position[0],
                            'y': position[1]
                        });

                        var connection = {
                            id: d.id,
                            bends: bends
                        };

                        // update the label index if necessary
                        // 필요한 경우 레이블 색인을 업데이트합니다.
                        var labelIndex = d.component.labelIndex;
                        if (bends.length === 1) {
                            connection.labelIndex = 0;
                        } else if (bendIndex <= labelIndex) {
                            connection.labelIndex = labelIndex + 1;
                        }

                        // save the new state
                        // 새 상태 저장
                        save(d, connection);

                        d3.event.stopPropagation();
                    } else {
                        return null;
                    }
                });
        }

        updated.each(function (d) {
            var connection = d3.select(this);

            if (updatePath === true) {
                // calculate the start and end points
                // 시작점과 끝점을 계산합니다.
                var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(d);
                var sourceData = d3.select('#id-' + sourceComponentId).datum();
                var end;

                // get the appropriate end anchor point
                // 적절한 end anchor point를 얻는다.
                var endAnchor;
                if (d.bends.length > 0) {
                    endAnchor = d.bends[d.bends.length - 1];
                } else {
                    endAnchor = {
                        x: sourceData.position.x + (sourceData.dimensions.width / 2),
                        y: sourceData.position.y + (sourceData.dimensions.height / 2)
                    };
                }

                // if we are currently dragging the endpoint to a new target, use that
                // position, otherwise we need to calculate it for the current target
                // 현재 새 끝점을 새 대상으로 드래그하는 경우 해당 위치를 사용하고 그렇지 않으면 현재 대상에 대해 끝점을 계산해야합니다.
                if (nfCommon.isDefinedAndNotNull(d.end) && d.end.dragging === true) {
                    // since we're dragging, use the same object thats bound to the endpoint drag event
                    // 드래그하기 때문에 끝점 드래그 이벤트에 바인딩 된 동일한 객체를 사용하십시오.
                    end = d.end;

                    // if we're not over a connectable destination use the current point
                    // 연결 가능한 목적지가 아닌 경우 현재 점을 사용합니다.
                    var newDestination = d3.select('g.hover.connectable-destination');
                    if (!newDestination.empty()) {
                        var newDestinationData = newDestination.datum();

                        // get the position on the new destination perimeter
                        // 새 대상 경계에서 위치를 가져옵니다.
                        var newEnd = nfCanvasUtils.getPerimeterPoint(endAnchor, {
                            'x': newDestinationData.position.x,
                            'y': newDestinationData.position.y,
                            'width': newDestinationData.dimensions.width,
                            'height': newDestinationData.dimensions.height
                        });

                        // update the coordinates with the new point
                        end.x = newEnd.x;
                        end.y = newEnd.y;
                    }
                } else {
                    var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(d);
                    var destinationData = d3.select('#id-' + destinationComponentId).datum();

                    // get the position on the destination perimeter
                    // 대상 경계에서 위치를 가져옵니다.
                    end = nfCanvasUtils.getPerimeterPoint(endAnchor, {
                        'x': destinationData.position.x,
                        'y': destinationData.position.y,
                        'width': destinationData.dimensions.width,
                        'height': destinationData.dimensions.height
                    });
                }

                // get the appropriate start anchor point
                // 적절한 시작 앵커 포인트를 얻습니다.
                var startAnchor;
                if (d.bends.length > 0) {
                    startAnchor = d.bends[0];
                } else {
                    startAnchor = end;
                }

                // get the position on the source perimeter
                // 소스 경계에서 위치를 얻습니다.
                var start = nfCanvasUtils.getPerimeterPoint(startAnchor, {
                    'x': sourceData.position.x,
                    'y': sourceData.position.y,
                    'width': sourceData.dimensions.width,
                    'height': sourceData.dimensions.height
                });

                // store the updated endpoints
                // 업데이트 된 끝점을 저장합니다.
                d.start = start;
                d.end = end;

                // update the connection paths
                // 연결 경로 업데이트
                nfCanvasUtils.transition(connection.select('path.connection-path'), transition)
                    .attrs({
                        'd': function () {
                            var datum = [d.start].concat(d.bends, [d.end]);
                            return lineGenerator(datum);
                        }
                    });
                nfCanvasUtils.transition(connection.select('path.connection-selection-path'), transition)
                    .attrs({
                        'd': function () {
                            var datum = [d.start].concat(d.bends, [d.end]);
                            return lineGenerator(datum);
                        }
                    });
                nfCanvasUtils.transition(connection.select('path.connection-path-selectable'), transition)
                    .attrs({
                        'd': function () {
                            var datum = [d.start].concat(d.bends, [d.end]);
                            return lineGenerator(datum);
                        }
                    });

                // -----
                // bends
                // 굴곡
                // -----

                var startpoints = connection.selectAll('rect.startpoint');
                var endpoints = connection.selectAll('rect.endpoint');
                var midpoints = connection.selectAll('rect.midpoint');

                // require read and write permissions as it's required to read the connections available relationships
                // when connecting to a group or remote group
                // 그룹 또는 원격 그룹에 연결할 때 사용 가능한 연결을 읽는 데 필요한 읽기 및 쓰기 권한이 필요합니다.
                if (d.permissions.canWrite && d.permissions.canRead) {

                    // ------------------
                    // bends - startpoint
                    // 굴곡 - 시작 포인트
                    // ------------------

                    startpoints = startpoints.data([d.start]);

                    // create a point for the start
                    // 시작 지점을 만듭니다.
                    var startpointsEntered = startpoints.enter().append('rect')
                        .attrs({
                            'class': 'startpoint linepoint',
                            'pointer-events': 'all',
                            'width': 8,
                            'height': 8
                        })
                        .on('mousedown.selection', function () {
                            // select the connection when clicking the label
                            // 레이블을 클릭 할 때 연결을 선택하십시오.
                            nfSelectable.select(d3.select(this.parentNode));

                            // update URL deep linking params
                            // URL 딥 링크 매개 변수 업데이트
                            nfCanvasUtils.setURLParameters();
                        })
                        .call(nfContextMenu.activate);

                    // update the start point
                    // 시작점을 업데이트합니다.
                    nfCanvasUtils.transition(startpoints.merge(startpointsEntered), transition)
                        .attr('transform', function (p) {
                            return 'translate(' + (p.x - 4) + ', ' + (p.y - 4) + ')';
                        });

                    // remove old items
                    // 이전 항목을 삭제합니다.
                    startpoints.exit().remove();

                    // ----------------
                    // bends - endpoint
                    // 굴곡 - 끝 포인트
                    // ----------------

                    var endpoints = endpoints.data([d.end]);

                    // create a point for the end
                    // 끝 지점을 만듭니다.
                    var endpointsEntered = endpoints.enter().append('rect')
                        .attrs({
                            'class': 'endpoint linepoint',
                            'pointer-events': 'all',
                            'width': 8,
                            'height': 8
                        })
                        .on('mousedown.selection', function () {
                            // select the connection when clicking the label
                            // 레이블을 클릭 할 때 연결을 선택하십시오.
                            nfSelectable.select(d3.select(this.parentNode));

                            // update URL deep linking params
                            // URL 딥 링크 매개 변수 업데이트
                            nfCanvasUtils.setURLParameters();
                        })
                        .call(endpointDrag)
                        .call(nfContextMenu.activate);

                    // update the end point
                    // 끝점을 업데이트합니다.
                    nfCanvasUtils.transition(endpoints.merge(endpointsEntered), transition)
                        .attr('transform', function (p) {
                            return 'translate(' + (p.x - 4) + ', ' + (p.y - 4) + ')';
                        });

                    // remove old items
                    // 이전 항목을 삭제합니다.
                    endpoints.exit().remove();

                    // -----------------
                    // bends - midpoints
                    // 굴곡 - 중간 포인트
                    // -----------------

                    var midpoints = midpoints.data(d.bends);

                    // create a point for the end
                    // 끝 지점을 만듭니다.
                    var midpointsEntered = midpoints.enter().append('rect')
                        .attrs({
                            'class': 'midpoint linepoint',
                            'pointer-events': 'all',
                            'width': 8,
                            'height': 8
                        })
                        .on('dblclick', function (p) {
                            // stop event propagation
                            // 이벤트 전달을 중지합니다.
                            d3.event.stopPropagation();

                            var connection = d3.select(this.parentNode);
                            var connectionData = connection.datum();

                            // if this is a self loop prevent removing the last two bends
                            // 이것이 마지막 루프를 제거하지 못하도록하는 자체 루프 인 경우
                            var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(connectionData);
                            var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(connectionData);
                            if (sourceComponentId === destinationComponentId && d.component.bends.length <= 2) {
                                nfDialog.showOkDialog({
                                    headerText: 'Connection',
                                    dialogContent: 'Looping connections must have at least two bend points.'
                                });
                                return;
                            }

                            var newBends = [];
                            var bendIndex = -1;

                            // create a new array of bends without the selected one
                            // 선택된 배열을 제외한 새로운 배열을 만듭니다.
                            $.each(connectionData.component.bends, function (i, bend) {
                                if (p.x !== bend.x && p.y !== bend.y) {
                                    newBends.push(bend);
                                } else {
                                    bendIndex = i;
                                }
                            });

                            if (bendIndex < 0) {
                                return;
                            }

                            var connection = {
                                id: connectionData.id,
                                bends: newBends
                            };

                            // update the label index if necessary
                            // 필요한 경우 레이블 색인을 업데이트합니다.
                            var labelIndex = connectionData.component.labelIndex;
                            if (newBends.length <= 1) {
                                connection.labelIndex = 0;
                            } else if (bendIndex <= labelIndex) {
                                connection.labelIndex = Math.max(0, labelIndex - 1);
                            }

                            // save the updated connection
                            // 업데이트 된 연결을 저장합니다.
                            save(connectionData, connection);
                        })
                        .on('mousedown.selection', function () {
                            // select the connection when clicking the label
                            // 레이블을 클릭 할 때 연결을 선택하십시오.
                            nfSelectable.select(d3.select(this.parentNode));

                            // update URL deep linking params
                            // URL 딥 링크 매개 변수 업데이트
                            nfCanvasUtils.setURLParameters();
                        })
                        .call(bendPointDrag)
                        .call(nfContextMenu.activate);

                    // update the midpoints
                    // 중간 점 업데이트
                    nfCanvasUtils.transition(midpoints.merge(midpointsEntered), transition)
                        .attr('transform', function (p) {
                            return 'translate(' + (p.x - 4) + ', ' + (p.y - 4) + ')';
                        });

                    // remove old items
                    // 이전 항목을 삭제합니다.
                    midpoints.exit().remove();
                } else {
                    // remove the start, mid, and end points
                    // 시작점, 중간 점 및 끝점을 제거합니다.
                    startpoints.remove();
                    endpoints.remove();
                    midpoints.remove();
                }
            }

            if (updateLabel === true) {
                var connectionLabelContainer = connection.select('g.connection-label-container');

                // update visible connections
                // 보이는 연결을 갱신한다.
                if (connection.classed('visible')) {

                    // if there is no connection label this connection is becoming
                    // visible so we need to render it
                    // 연결 레이블이없는 경우이 연결이 표시되어 렌더링해야합니다.
                    if (connectionLabelContainer.empty()) {
                        // connection label container
                        // 연결 레이블 컨테이너
                        connectionLabelContainer = connection.insert('g', 'rect.startpoint')
                            .attrs({
                                'class': 'connection-label-container',
                                'pointer-events': 'all'
                            })
                            .on('mousedown.selection', function () {
                                // select the connection when clicking the label
                                // 레이블을 클릭 할 때 연결을 선택하십시오.
                                nfSelectable.select(d3.select(this.parentNode));

                                // update URL deep linking params
                                // URL 딥 링크 매개 변수 업데이트
                                nfCanvasUtils.setURLParameters();
                            })
                            .call(nfContextMenu.activate).call(nfQuickSelect.activate);

                        // connection label
                        connectionLabelContainer.append('rect')
                            .attrs({
                                'class': 'body',
                                'width': dimensions.width,
                                'x': 0,
                                'y': 0
                            });

                        // processor border
                        connectionLabelContainer.append('rect')
                            .attrs({
                                'class': 'border',
                                'width': dimensions.width,
                                'fill': 'transparent',
                                'stroke': 'transparent'
                            });
                    }

                    var labelCount = 0;
                    var rowHeight = 19;
                    var backgrounds = [];
                    var borders = [];

                    var connectionFrom = connectionLabelContainer.select('g.connection-from-container');
                    var connectionTo = connectionLabelContainer.select('g.connection-to-container');
                    var connectionName = connectionLabelContainer.select('g.connection-name-container');

                    if (d.permissions.canRead) {

                        // -----------------------
                        // connection label - from
                        // -----------------------

                        // determine if the connection require a from label
                        // 연결에 레이블이 필요한지 여부를 결정합니다.
                        if (isGroup(d.component.source)) {
                            // see if the connection from label is already rendered
                            // label로부터의 연결이 이미 렌더링되었는지 확인
                            if (connectionFrom.empty()) {
                                connectionFrom = connectionLabelContainer.append('g')
                                    .attrs({
                                        'class': 'connection-from-container'
                                    });

                                // background
                                backgrounds.push(connectionFrom.append('rect')
                                    .attrs({
                                        'class': 'connection-label-background',
                                        'width': dimensions.width,
                                        'height': rowHeight
                                    }));

                                // border
                                borders.push(connectionFrom.append('rect')
                                    .attrs({
                                        'class': 'connection-label-border',
                                        'width': dimensions.width,
                                        'height': 1
                                    }));

                                connectionFrom.append('text')
                                    .attrs({
                                        'class': 'stats-label',
                                        'x': 5,
                                        'y': 14
                                    })
                                    .text('From');

                                connectionFrom.append('text')
                                    .attrs({
                                        'class': 'stats-value connection-from',
                                        'x': 43,
                                        'y': 14,
                                        'width': 130
                                    });

                                connectionFrom.append('text')
                                    .attrs({
                                        'class': 'connection-from-run-status',
                                        'x': 208,
                                        'y': 14
                                    });
                            } else {
                                backgrounds.push(connectionFrom.select('rect.connection-label-background'));
                                borders.push(connectionFrom.select('rect.connection-label-border'));
                            }

                            // update the connection from positioning
                            // 위치 지정에서 연결을 업데이트합니다.
                            connectionFrom.attr('transform', function () {
                                var y = (rowHeight * labelCount++);
                                return 'translate(0, ' + y + ')';
                            });

                            // update the label text
                            connectionFrom.select('text.connection-from')
                                .each(function () {
                                    var connectionFromLabel = d3.select(this);

                                    // reset the label name to handle any previous state
                                    // 이전 상태를 처리하기 위해 레이블 이름을 재설정합니다.
                                    connectionFromLabel.text(null).selectAll('title').remove();

                                    // apply ellipsis to the label as necessary
                                    // 필요에 따라 줄임표를 레이블에 적용합니다.
                                    nfCanvasUtils.ellipsis(connectionFromLabel, d.component.source.name);
                                }).append('title').text(function () {
                                return d.component.source.name;
                            });

                            // update the label run status
                            // 라벨 실행 상태를 업데이트합니다.
                            connectionFrom.select('text.connection-from-run-status')
                                .text(function () {
                                    if (d.component.source.exists === false) {
                                        return '\uf071';
                                    } else if (d.component.source.running === true) {
                                        return '\uf04b';
                                    } else {
                                        return '\uf04d';
                                    }
                                })
                                .classed('running', function () {
                                    if (d.component.source.exists === false) {
                                        return false;
                                    } else {
                                        return d.component.source.running;
                                    }
                                })
                                .classed('stopped', function () {
                                    if (d.component.source.exists === false) {
                                        return false;
                                    } else {
                                        return !d.component.source.running;
                                    }
                                })
                                .classed('is-missing-port', function () {
                                    return d.component.source.exists === false;
                                });
                        } else {
                            // there is no connection from, remove the previous if necessary
                            // 연결이 없으면 필요한 경우 이전을 제거합니다.
                            connectionFrom.remove();
                        }

                        // ---------------------
                        // connection label - to
                        // ---------------------

                        // determine if the connection require a to label
                        // 연결에 레이블이 필요한지 여부를 결정합니다.
                        if (isGroup(d.component.destination)) {
                            see if the connection to label is already rendered
                            if (connectionTo.empty()) {
                                connectionTo = connectionLabelContainer.append('g')
                                    .attrs({
                                        'class': 'connection-to-container'
                                    });

                                // background
                                backgrounds.push(connectionTo.append('rect')
                                    .attrs({
                                        'class': 'connection-label-background',
                                        'width': dimensions.width,
                                        'height': rowHeight
                                    }));

                                // border
                                borders.push(connectionTo.append('rect')
                                    .attrs({
                                        'class': 'connection-label-border',
                                        'width': dimensions.width,
                                        'height': 1
                                    }));

                                connectionTo.append('text')
                                    .attrs({
                                        'class': 'stats-label',
                                        'x': 5,
                                        'y': 14
                                    })
                                    .text('To');

                                connectionTo.append('text')
                                    .attrs({
                                        'class': 'stats-value connection-to',
                                        'x': 25,
                                        'y': 14,
                                        'width': 145
                                    });

                                connectionTo.append('text')
                                    .attrs({
                                        'class': 'connection-to-run-status',
                                        'x': 208,
                                        'y': 14
                                    });
                            } else {
                                backgrounds.push(connectionTo.select('rect.connection-label-background'));
                                borders.push(connectionTo.select('rect.connection-label-border'));
                            }

                            // update the connection to positioning
                            // 위치 지정에 대한 연결을 업데이트합니다.
                            connectionTo.attr('transform', function () {
                                var y = (rowHeight * labelCount++);
                                return 'translate(0, ' + y + ')';
                            });

                            // update the label text
                            connectionTo.select('text.connection-to')
                                .each(function (d) {
                                    var connectionToLabel = d3.select(this);

                                    // reset the label name to handle any previous state
                                    // 이전 상태를 처리하기 위해 레이블 이름을 재설정합니다.
                                    connectionToLabel.text(null).selectAll('title').remove();

                                    // apply ellipsis to the label as necessary
                                    // 필요에 따라 줄임표를 레이블에 적용합니다.
                                    nfCanvasUtils.ellipsis(connectionToLabel, d.component.destination.name);
                                }).append('title').text(function (d) {
                                return d.component.destination.name;
                            });

                            // update the label run status
                            // 라벨 실행 상태를 업데이트합니다.
                            connectionTo.select('text.connection-to-run-status')
                                .text(function () {
                                    if (d.component.destination.exists === false) {
                                        return '\uf071';
                                    } else if (d.component.destination.running === true) {
                                        return '\uf04b';
                                    } else {
                                        return '\uf04d';
                                    }
                                })
                                .classed('running', function () {
                                    if (d.component.destination.exists === false) {
                                        return false;
                                    } else {
                                        return d.component.destination.running;
                                    }
                                })
                                .classed('stopped', function () {
                                    if (d.component.destination.exists === false) {
                                        return false;
                                    } else {
                                        return !d.component.destination.running;
                                    }
                                })
                                .classed('is-missing-port', function () {
                                    return d.component.destination.exists === false;
                                });
                        } else {
                            // there is no connection to, remove the previous if necessary
                            // 연결이 없으면 필요한 경우 이전을 제거합니다.
                            connectionTo.remove();
                        }

                        // -----------------------
                        // connection label - name
                        // -----------------------

                        // get the connection name
                        // 연결 이름을 얻습니다.
                        var connectionNameValue = nfCanvasUtils.formatConnectionName(d.component);

                        // is there a name to render
                        // 렌더링 할 이름이 있습니다.
                        if (!nfCommon.isBlank(connectionNameValue)) {
                            // see if the connection name label is already rendered
                            // 연결 이름 레이블이 이미 렌더링되어 있는지 확인합니다.
                            if (connectionName.empty()) {
                                connectionName = connectionLabelContainer.append('g')
                                    .attrs({
                                        'class': 'connection-name-container'
                                    });

                                // background
                                backgrounds.push(connectionName.append('rect')
                                    .attrs({
                                        'class': 'connection-label-background',
                                        'width': dimensions.width,
                                        'height': rowHeight
                                    }));

                                // border
                                borders.push(connectionName.append('rect')
                                    .attrs({
                                        'class': 'connection-label-border',
                                        'width': dimensions.width,
                                        'height': 1
                                    }));

                                connectionName.append('text')
                                    .attrs({
                                        'class': 'stats-label',
                                        'x': 5,
                                        'y': 14
                                    })
                                    .text('Name');

                                connectionName.append('text')
                                    .attrs({
                                        'class': 'stats-value connection-name',
                                        'x': 45,
                                        'y': 14,
                                        'width': 142
                                    });
                            } else {
                                backgrounds.push(connectionName.select('rect.connection-label-background'));
                                borders.push(connectionName.select('rect.connection-label-border'));
                            }

                            // update the connection name positioning
                            // 연결 이름 위치를 업데이트합니다.
                            connectionName.attr('transform', function () {
                                var y = (rowHeight * labelCount++);
                                return 'translate(0, ' + y + ')';
                            });

                            // update the connection name
                            // 연결 이름을 업데이트합니다.
                            connectionName.select('text.connection-name')
                                .each(function () {
                                    var connectionToLabel = d3.select(this);

                                    // reset the label name to handle any previous state
                                    // 이전 상태를 처리하기 위해 레이블 이름을 재설정합니다.
                                    connectionToLabel.text(null).selectAll('title').remove();

                                    // apply ellipsis to the label as necessary
                                    // 필요에 따라 줄임표를 레이블에 적용합니다.
                                    nfCanvasUtils.ellipsis(connectionToLabel, connectionNameValue);
                                }).append('title').text(function () {
                                return connectionNameValue;
                            });
                        } else {
                            // there is no connection name, remove the previous if necessary
                            // 연결 이름이 없으면 필요에 따라 이전 이름을 제거합니다.
                            connectionName.remove();
                        }
                    } else {
                        // no permissions to read to remove previous if necessary
                        // 필요한 경우 이전을 제거하기 위해 읽을 권한 없음
                        connectionFrom.remove();
                        connectionTo.remove();
                        connectionName.remove();
                    }

                    // -------------------------
                    // connection label - queued
                    // -------------------------

                    var HEIGHT_FOR_BACKPRESSURE = 3;

                    // see if the queue label is already rendered
                    // 큐 레이블이 이미 렌더링되었는지 확인합니다.
                    var queued = connectionLabelContainer.select('g.queued-container');
                    if (queued.empty()) {
                        queued = connectionLabelContainer.append('g')
                            .attrs({
                                'class': 'queued-container'
                            });

                        // background
                        backgrounds.push(queued.append('rect')
                            .attrs({
                                'class': 'connection-label-background',
                                'width': dimensions.width,
                                'height': rowHeight + HEIGHT_FOR_BACKPRESSURE
                            }));

                        // border
                        borders.push(queued.append('rect')
                            .attrs({
                                'class': 'connection-label-border',
                                'width': dimensions.width,
                                'height': 1
                            }));

                        queued.append('text')
                            .attrs({
                                'class': 'stats-label',
                                'x': 5,
                                'y': 14
                            })
                            .text('Queued');

                        var queuedText = queued.append('text')
                            .attrs({
                                'class': 'stats-value queued',
                                'x': 55,
                                'y': 14
                            });

                        // queued count
                        queuedText.append('tspan')
                            .attrs({
                                'class': 'count'
                            });

                        // queued size
                        queuedText.append('tspan')
                            .attrs({
                                'class': 'size'
                            });

                        // load balance icon
                        // x is set dynamically to slide to right, depending on whether expiration icon is shown.
                        // 만료 아이콘이 표시되는지 여부에 따라 x가 오른쪽으로 슬라이드되도록 동적으로 설정됩니다.
                        queued.append('text')
                            .attrs({
                                'class': 'load-balance-icon',
                                'y': 14
                            })
                            .text(function () {
                                return '\uf042';
                            })
                            .append('title');

                        // expiration icon
                        // 만료 아이콘
                        queued.append('text')
                            .attrs({
                                'class': 'expiration-icon',
                                'x': 208,
                                'y': 14
                            })
                            .text(function () {
                                return '\uf017';
                            })
                            .append('title');

                        var yBackpressureOffset = rowHeight + HEIGHT_FOR_BACKPRESSURE - 4;

                        // backpressure object threshold
                        // 배압 객체 임계 값

                        // start
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-tick object',
                                'width': 1,
                                'height': 3,
                                'x': 5,
                                'y': yBackpressureOffset
                            });

                        // bar
                        var backpressureCountOffset = 6;
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-object',
                                'width': backpressureBarWidth,
                                'height': 3,
                                'x': backpressureCountOffset,
                                'y': yBackpressureOffset
                            })
                            .append('title');

                        // end
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-tick object',
                                'width': 1,
                                'height': 3,
                                'x': backpressureCountOffset + backpressureBarWidth,
                                'y': yBackpressureOffset
                            });

                        // percent full
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-percent object',
                                'width': 0,
                                'height': 3,
                                'x': backpressureCountOffset,
                                'y': yBackpressureOffset
                            });

                        // backpressure data size threshold
                        // 배압 데이터 크기 임계 값

                        // start
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-tick data-size',
                                'width': 1,
                                'height': 3,
                                'x': (dimensions.width / 2) + 10,
                                'y': yBackpressureOffset
                            });

                        // bar
                        var backpressureDataSizeOffset = (dimensions.width / 2) + 10 + 1;
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-data-size',
                                'width': backpressureBarWidth,
                                'height': 3,
                                'x': backpressureDataSizeOffset,
                                'y': yBackpressureOffset
                            })
                            .append('title');

                        // end
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-tick data-size',
                                'width': 1,
                                'height': 3,
                                'x': backpressureDataSizeOffset + backpressureBarWidth,
                                'y': yBackpressureOffset
                            });

                        // percent full
                        queued.append('rect')
                            .attrs({
                                'class': 'backpressure-percent data-size',
                                'width': 0,
                                'height': 3,
                                'x': backpressureDataSizeOffset,
                                'y': yBackpressureOffset
                            });
                    } else {
                        backgrounds.push(queued.select('rect.connection-label-background'));
                        borders.push(queued.select('rect.connection-label-border'));
                    }

                    // update the queued vertical positioning as necessary
                    // 필요에 따라 대기중인 수직 위치를 업데이트합니다.
                    queued.attr('transform', function () {
                        var y = (rowHeight * labelCount++);
                        return 'translate(0, ' + y + ')';
                    });

                    // update the height based on the labels being rendered
                    // 렌더링되는 라벨을 기준으로 높이를 업데이트합니다.
                    connectionLabelContainer.select('rect.body')
                        .attr('height', function () {
                            return (rowHeight * labelCount) + HEIGHT_FOR_BACKPRESSURE;
                        })
                        .classed('unauthorized', function () {
                            return d.permissions.canRead === false;
                        });
                    connectionLabelContainer.select('rect.border')
                        .attr('height', function () {
                            return (rowHeight * labelCount) + HEIGHT_FOR_BACKPRESSURE;
                        })
                        .classed('unauthorized', function () {
                            return d.permissions.canRead === false;
                        });

                    // update the coloring of the backgrounds
                    // 배경색 변경
                    $.each(backgrounds, function (i, background) {
                        if (i % 2 === 0) {
                            background.attr('fill', '#f4f6f7');
                        } else {
                            background.attr('fill', '#ffffff');
                        }
                    });

                    // update the coloring of the label borders
                    // 라벨 테두리의 색상을 업데이트합니다.
                    $.each(borders, function (i, border) {
                        if (i > 0) {
                            border.attr('fill', '#c7d2d7');
                        } else {
                            border.attr('fill', 'transparent');
                        }
                    });

                    // determine whether or not to show the load-balance icon
                    //로드 밸런스 아이콘을 표시할지 여부를 결정합니다.
                    connectionLabelContainer.select('text.load-balance-icon')
                        .classed('hidden', function () {
                            if (d.permissions.canRead) {
                                return !isLoadBalanceConfigured(d.component);
                            } else {
                                return true;
                            }
                        }).classed('load-balance-icon-active fa-rotate-90', function (d) {
                            return d.permissions.canRead && d.component.loadBalanceStatus === 'LOAD_BALANCE_ACTIVE';

                        }).classed('load-balance-icon-184', function() {
                            return d.permissions.canRead && isExpirationConfigured(d.component);

                        }).classed('load-balance-icon-200', function() {
                            return d.permissions.canRead && !isExpirationConfigured(d.component);

                        }).attr('x', function() {
                            return d.permissions.canRead && isExpirationConfigured(d.component) ? 192 : 208;

                        }).select('title').text(function () {
                            if (d.permissions.canRead) {
                                var loadBalanceStrategy = nfCommon.getComboOptionText(nfCommon.loadBalanceStrategyOptions, d.component.loadBalanceStrategy);
                                if ('PARTITION_BY_ATTRIBUTE' === d.component.loadBalanceStrategy) {
                                    loadBalanceStrategy += ' (' + d.component.loadBalancePartitionAttribute + ')'
                                }

                                var loadBalanceCompression = 'no compression';
                                switch (d.component.loadBalanceCompression) {
                                    case 'COMPRESS_ATTRIBUTES_ONLY':
                                        loadBalanceCompression = '\'Attribute\' compression';
                                        break;
                                    case 'COMPRESS_ATTRIBUTES_AND_CONTENT':
                                        loadBalanceCompression = '\'Attribute and content\' compression';
                                        break;
                                }
                                var loadBalanceStatus = 'LOAD_BALANCE_ACTIVE' === d.component.loadBalanceStatus ? ' Actively balancing...' : '';
                                return 'Load Balance is configured'
                                        + ' with \'' + loadBalanceStrategy + '\' strategy'
                                        + ' and ' + loadBalanceCompression + '.'
                                        + loadBalanceStatus;
                            } else {
                                return '';
                            }
                        });

                    // determine whether or not to show the expiration icon
                    // 만료 아이콘을 표시할지 여부를 결정합니다.
                    connectionLabelContainer.select('text.expiration-icon')
                        .classed('hidden', function () {
                            if (d.permissions.canRead) {
                                return !isExpirationConfigured(d.component);
                            } else {
                                return true;
                            }
                        })
                        .select('title').text(function () {
                        if (d.permissions.canRead) {
                            return 'Expires FlowFiles older than ' + d.component.flowFileExpiration;
                        } else {
                            return '';
                        }
                    });

                    // update backpressure object fill
                    // 배압 객체 채우기 업데이트
                    connectionLabelContainer.select('rect.backpressure-object')
                        .classed('not-configured', function () {
                            return nfCommon.isUndefinedOrNull(d.status.aggregateSnapshot.percentUseCount);
                        });
                    connectionLabelContainer.selectAll('rect.backpressure-tick.object')
                        .classed('not-configured', function () {
                            return nfCommon.isUndefinedOrNull(d.status.aggregateSnapshot.percentUseCount);
                        });

                    // update backpressure data size fill
                    // 배압 데이터 크기를 업데이트합니다.
                    connectionLabelContainer.select('rect.backpressure-data-size')
                        .classed('not-configured', function () {
                            return nfCommon.isUndefinedOrNull(d.status.aggregateSnapshot.percentUseBytes);
                        });
                    connectionLabelContainer.selectAll('rect.backpressure-tick.data-size')
                        .classed('not-configured', function () {
                            return nfCommon.isUndefinedOrNull(d.status.aggregateSnapshot.percentUseBytes);
                        });

                    if (d.permissions.canWrite) {
                        // only support dragging the label when appropriate
                        // 적절한 경우 레이블 드래그 만 지원합니다.
                        connectionLabelContainer.call(labelDrag);
                    }

                    // update the connection status
                    // 연결 상태를 업데이트합니다.
                    connection.call(updateConnectionStatus);
                } else {
                    if (!connectionLabelContainer.empty()) {
                        connectionLabelContainer.remove();
                    }
                }
            }

            // update the position of the label if possible
            // 가능한 경우 레이블의 위치를 업데이트합니다.
            nfCanvasUtils.transition(connection.select('g.connection-label-container'), transition)
                .attr('transform', function () {
                    var label = d3.select(this).select('rect.body');
                    var position = getLabelPosition(label);
                    return 'translate(' + position.x + ', ' + position.y + ')';
                });
        });
    };

    /**
     * Updates the stats of the connections in the specified selection.
     * 지정된 선택 항목에서 연결의 통계를 업데이트하십시오.
     *
     * @param {selection} updated       The selected connections to update 업데이트할 선택된 연결
     */
    var updateConnectionStatus = function (updated) {
        if (updated.empty()) {
            return;
        }

        // update data size
        var dataSizeDeferred = $.Deferred(function (deferred) {
            // queued count value
            updated.select('text.queued tspan.count')
                .text(function (d) {
                    return nfCommon.substringBeforeFirst(d.status.aggregateSnapshot.queued, ' ');
                });

            var backpressurePercentDataSize = updated.select('rect.backpressure-percent.data-size');
            backpressurePercentDataSize.transition()
                .duration(400)
                .attrs({
                    'width': function (d) {
                        if (nfCommon.isDefinedAndNotNull(d.status.aggregateSnapshot.percentUseBytes)) {
                            return (backpressureBarWidth * d.status.aggregateSnapshot.percentUseBytes) / 100;
                        } else {
                            return 0;
                        }
                    }
                }).on('end', function () {
                backpressurePercentDataSize
                    .classed('warning', function (d) {
                        return isWarningBytes(d);
                    })
                    .classed('error', function (d) {
                        return isErrorBytes(d);
                    });

                deferred.resolve();
            });

            updated.select('rect.backpressure-data-size').select('title').text(function (d) {
                if (nfCommon.isDefinedAndNotNull(d.status.aggregateSnapshot.percentUseBytes)) {
                    return 'Queue is ' + d.status.aggregateSnapshot.percentUseBytes + '% full based on Back Pressure Data Size Threshold';
                } else {
                    return 'Back Pressure Data Size Threshold is not configured';
                }
            });
        }).promise();

        // update object count
        var objectCountDeferred = $.Deferred(function (deferred) {
            // queued size value
            updated.select('text.queued tspan.size')
                .text(function (d) {
                    return ' ' + nfCommon.substringAfterFirst(d.status.aggregateSnapshot.queued, ' ');
                });

            var backpressurePercentObject = updated.select('rect.backpressure-percent.object');
            backpressurePercentObject.transition()
                .duration(400)
                .attrs({
                    'width': function (d) {
                        if (nfCommon.isDefinedAndNotNull(d.status.aggregateSnapshot.percentUseCount)) {
                            return (backpressureBarWidth * d.status.aggregateSnapshot.percentUseCount) / 100;
                        } else {
                            return 0;
                        }
                    }
                }).on('end', function () {
                backpressurePercentObject
                    .classed('warning', function (d) {
                        return isWarningCount(d);
                    })
                    .classed('error', function (d) {
                        return isErrorCount(d);
                    });

                deferred.resolve();
            });

            updated.select('rect.backpressure-object').select('title').text(function (d) {
                if (nfCommon.isDefinedAndNotNull(d.status.aggregateSnapshot.percentUseCount)) {
                    return 'Queue is ' + d.status.aggregateSnapshot.percentUseCount + '% full based on Back Pressure Object Threshold';
                } else {
                    return 'Back Pressure Object Threshold is not configured';
                }
            });
        }).promise();

        // update connection once progress bars have transitioned
        $.when(dataSizeDeferred, objectCountDeferred).done(function () {
            // connection stroke
            updated.select('path.connection-path')
                .classed('full', function (d) {
                    return isFullCount(d) || isFullBytes(d);
                })
                .attrs({
                    'marker-end': getEndMarker
                });

            // border
            updated.select('rect.border')
                .classed('full', function (d) {
                    return isFullCount(d) || isFullBytes(d);
                });

            // drop shadow
            updated.select('rect.body')
                .attrs({
                    'filter': getDropShadow
                });
        });
    };

    /**
     * Saves the connection entry specified by d with the new configuration specified
     * in connection.
     * d에 지정된 연결 항목을 connection에 지정된 새 구성으로 저장합니다.
     *
     * @param {type} d
     * @param {type} connection
     */
    var save = function (d, connection) {
        var entity = {
            'revision': nfClient.getRevision(d),
            'disconnectedNodeAcknowledged': nfStorage.isDisconnectionAcknowledged(),
            'component': connection
        };

        return $.ajax({
            type: 'PUT',
            url: d.uri,
            data: JSON.stringify(entity),
            dataType: 'json',
            contentType: 'application/json'
        }).done(function (response) {
            // request was successful, update the entry
            // 요청이 성공하면 항목을 업데이트합니다.
            nfConnection.set(response);
        }).fail(nfErrorHandler.handleConfigurationUpdateAjaxError);
    };

    // removes the specified connections
    // 지정된 연결을 제거합니다.
    var removeConnections = function (removed) {
        // consider reloading source/destination of connection being removed
        // 제거중인 연결의 소스 / 대상을 다시로드하는 것을 고려하십시오.
        removed.each(function (d) {
            var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(d);
            var destinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(d);
            nfCanvasUtils.reloadConnectionSourceAndDestination(sourceComponentId, destinationComponentId);
        });

        // remove the connection
        removed.remove();
    };

    var nfConnection = {
        config: {
            selfLoopXOffset: (dimensions.width / 2) + 5,
            selfLoopYOffset: 25
        },

        /**
         * Initializes the connection.
         * 연결을 초기화합니다.
         *
         * @param nfSelectableRef   The nfSelectable module.
         * @param nfContextMenuRef   The nfContextMenu module.
         * @param nfQuickSelectRef   The nfQuickSelect module.
         */
        init: function (nfSelectableRef, nfContextMenuRef, nfQuickSelectRef, nfConnectionConfigurationRef) {
            nfSelectable = nfSelectableRef;
            nfContextMenu = nfContextMenuRef;
            nfQuickSelect = nfQuickSelectRef;
            nfConnectionConfiguration = nfConnectionConfigurationRef;

            connectionMap = d3.map();
            removedCache = d3.map();
            addedCache = d3.map();

            // create the connection container
            connectionContainer = d3.select('#canvas').append('g')
                .attrs({
                    'pointer-events': 'stroke',
                    'class': 'connections'
                });

            // define the line generator
            // 라인 제너레이터 정의
            lineGenerator = d3.line()
                .x(function (d) {
                    return d.x;
                })
                .y(function (d) {
                    return d.y;
                })
                .curve(d3.curveLinear);

            // handle bend point drag events
            // 벤드 포인트 드래그 이벤트 처리
            bendPointDrag = d3.drag()
                .on('start', function () {
                    // stop further propagation
                    // 추가 전달 중지
                    d3.event.sourceEvent.stopPropagation();
                })
                .on('drag', function (d) {
                    snapEnabled = !d3.event.sourceEvent.shiftKey;
                    d.x = snapEnabled ? (Math.round(d3.event.x/snapAlignmentPixels) * snapAlignmentPixels) : d3.event.x;
                    d.y = snapEnabled ? (Math.round(d3.event.y/snapAlignmentPixels) * snapAlignmentPixels) : d3.event.y;

                    // redraw this connection
                    //이 연결을 다시 그립니다.
                    d3.select(this.parentNode).call(updateConnections, {
                        'updatePath': true,
                        'updateLabel': false
                    });
                })
                .on('end', function () {
                    var connection = d3.select(this.parentNode);
                    var connectionData = connection.datum();
                    var bends = connection.selectAll('rect.midpoint').data();

                    // ensure the bend lengths are the same
                    // 굽힘 길이가 동일한지 확인하십시오.
                    if (bends.length === connectionData.component.bends.length) {
                        // determine if the bend points have moved
                        // 굽힘 포인트가 움직 였는지 판단
                        var different = false;
                        for (var i = 0; i < bends.length && !different; i++) {
                            if (bends[i].x !== connectionData.component.bends[i].x || bends[i].y !== connectionData.component.bends[i].y) {
                                different = true;
                            }
                        }

                        // only save the updated bends if necessary
                        // 필요한 경우 업데이트 된 굴곡부 만 저장합니다.
                        if (different) {
                            save(connectionData, {
                                id: connectionData.id,
                                bends: bends
                            }).fail(function () {
                                // restore the previous bend points
                                // 이전의 절곡 점 복원
                                connectionData.bends = $.map(connectionData.component.bends, function (bend) {
                                    return {
                                        x: bend.x,
                                        y: bend.y
                                    };
                                });

                                // refresh the connection
                                // 연결 새로 고침
                                connection.call(updateConnections, {
                                    'updatePath': true,
                                    'updateLabel': false
                                });
                            });
                        }
                    }

                    // stop further propagation
                    // 추가 전달 중지
                    d3.event.sourceEvent.stopPropagation();
                });

            // handle endpoint drag events
            // 끝점 드래그 이벤트를 처리합니다.
            endpointDrag = d3.drag()
                .on('start', function (d) {
                    // indicate that dragging has begun
                    // 드래그가 시작되었음을 나타냅니다.
                    d.dragging = true;

                    // stop further propagation
                    // 추가 전달 중지
                    d3.event.sourceEvent.stopPropagation();
                })
                .on('drag', function (d) {
                    d.x = d3.event.x - 8;
                    d.y = d3.event.y - 8;

                    // ensure the new destination is valid
                    // 새 대상이 유효한지 확인합니다.
                    d3.select('g.hover').classed('connectable-destination', function () {
                        return nfCanvasUtils.isValidConnectionDestination(d3.select(this));
                    });

                    // redraw this connection
                    //이 연결을 다시 그립니다.
                    d3.select(this.parentNode).call(updateConnections, {
                        'updatePath': true,
                        'updateLabel': false
                    });
                })
                .on('end', function (d) {
                    // indicate that dragging as stopped
                    // 드래그가 중지됨을 나타냅니다.
                    d.dragging = false;

                    // get the corresponding connection
                    // 해당 연결을 가져옵니다.
                    var connection = d3.select(this.parentNode);
                    var connectionData = connection.datum();
                    var previousDestinationComponentId = nfCanvasUtils.getConnectionDestinationComponentId(connectionData);

                    // attempt to select a new destination
                    // 새 대상을 선택하려고 시도합니다.
                    var destination = d3.select('g.connectable-destination');

                    // resets the connection if we're not over a new destination
                    // 우리가 새로운 목적지를 넘지 않는다면 연결을 재설정합니다.
                    if (destination.empty()) {
                        connection.call(updateConnections, {
                            'updatePath': true,
                            'updateLabel': false
                        });
                    } else {
                        // prompt for the new port if appropriate
                        // 적절한 경우 새 포트를 묻습니다.
                        if (nfCanvasUtils.isProcessGroup(destination) || nfCanvasUtils.isRemoteProcessGroup(destination)) {
                            // user will select new port and updated connect details will be set accordingly
                            // 사용자가 새 포트를 선택하고 그에 따라 업데이트 된 연결 세부 정보가 설정됩니다.
                            nfConnectionConfiguration.showConfiguration(connection, destination).done(function () {
                                // reload the previous destination
                                // 이전 대상을 다시로드합니다.
                                nfCanvasUtils.reloadConnectionSourceAndDestination(null, previousDestinationComponentId);
                            }).fail(function () {
                                // reset the connection
                                connection.call(updateConnections, {
                                    'updatePath': true,
                                    'updateLabel': false
                                });
                            });
                        } else {
                            // get the destination details
                            // 목적지 세부 정보를 얻으십시오.
                            var destinationData = destination.datum();
                            var destinationType = nfCanvasUtils.getConnectableTypeForDestination(destination);

                            var connectionEntity = {
                                'revision': nfClient.getRevision(connectionData),
                                'disconnectedNodeAcknowledged': nfStorage.isDisconnectionAcknowledged(),
                                'component': {
                                    'id': connectionData.id,
                                    'destination': {
                                        'id': destinationData.id,
                                        'groupId': nfCanvasUtils.getGroupId(),
                                        'type': destinationType
                                    }
                                }
                            };

                            // if this is a self loop and there are less than 2 bends, add them
                            // 이것이 자기 루프이고 굴곡이 2 개 미만인 경우 추가하십시오
                            if (connectionData.bends.length < 2 && connectionData.sourceId === destinationData.id) {
                                var rightCenter = {
                                    x: destinationData.position.x + (destinationData.dimensions.width),
                                    y: destinationData.position.y + (destinationData.dimensions.height / 2)
                                };
                                var xOffset = nfConnection.config.selfLoopXOffset;
                                var yOffset = nfConnection.config.selfLoopYOffset;

                                connectionEntity.component.bends = [];
                                connectionEntity.component.bends.push({
                                    'x': (rightCenter.x + xOffset),
                                    'y': (rightCenter.y - yOffset)
                                });
                                connectionEntity.component.bends.push({
                                    'x': (rightCenter.x + xOffset),
                                    'y': (rightCenter.y + yOffset)
                                });
                            }

                            $.ajax({
                                type: 'PUT',
                                url: connectionData.uri,
                                data: JSON.stringify(connectionEntity),
                                dataType: 'json',
                                contentType: 'application/json'
                            }).done(function (response) {
                                var updatedConnectionData = response.component;

                                // refresh to update the label
                                // 새로 고침하여 레이블을 업데이트하십시오.
                                nfConnection.set(response);

                                // reload the previous destination and the new source/destination
                                // 이전 대상 및 새 소스 / 대상을 다시로드하십시오.
                                nfCanvasUtils.reloadConnectionSourceAndDestination(null, previousDestinationComponentId);

                                var sourceComponentId = nfCanvasUtils.getConnectionSourceComponentId(response);
                                var destinationComponentId = nfCanvasUtils.getConnectionSourceComponentId(response);
                                nfCanvasUtils.reloadConnectionSourceAndDestination(sourceComponentId, destinationComponentId);
                            }).fail(function (xhr, status, error) {
                                if (xhr.status === 400 || xhr.status === 401 || xhr.status === 403 || xhr.status === 404 || xhr.status === 409) {
                                    nfDialog.showOkDialog({
                                        headerText: 'Connection',
                                        dialogContent: nfCommon.escapeHtml(xhr.responseText)
                                    });

                                    // reset the connection
                                    connection.call(updateConnections, {
                                        'updatePath': true,
                                        'updateLabel': false
                                    });
                                } else {
                                    nfErrorHandler.handleAjaxError(xhr, status, error);
                                }
                            });
                        }
                    }

                    // stop further propagation
                    // 추가 전파를 중지
                    d3.event.sourceEvent.stopPropagation();
                });

            // label drag behavior
            labelDrag = d3.drag()
                .on('start', function (d) {
                    // stop further propagation
                    // 추가 전파를 중지
                    d3.event.sourceEvent.stopPropagation();
                })
                .on('drag', function (d) {
                    if (d.bends.length > 1) {
                        // get the dragged component
                        // 드래그 된 구성 요소를 가져옵니다.
                        var drag = d3.select('rect.label-drag');

                        // lazily create the drag selection box
                        // 드래그 선택 상자를 늦게 만듭니다.
                        if (drag.empty()) {
                            var connectionLabel = d3.select(this).select('rect.body');

                            var position = getLabelPosition(connectionLabel);
                            var width = dimensions.width;
                            var height = connectionLabel.attr('height');

                            // create a selection box for the move
                            // 이동을위한 선택 상자를 만든다.
                            drag = d3.select('#canvas').append('rect')
                                .attr('x', position.x)
                                .attr('y', position.y)
                                .attr('class', 'label-drag')
                                .attr('width', width)
                                .attr('height', height)
                                .attr('stroke-width', function () {
                                    return 1 / nfCanvasUtils.getCanvasScale();
                                })
                                .attr('stroke-dasharray', function () {
                                    return 4 / nfCanvasUtils.getCanvasScale();
                                })
                                .datum({
                                    x: position.x,
                                    y: position.y,
                                    width: width,
                                    height: height
                                });
                        } else {
                            // update the position of the drag selection
                            // 드래그 선택 위치를 업데이트합니다.
                            drag.attr('x', function (d) {
                                d.x += d3.event.dx;
                                return d.x;
                            })
                                .attr('y', function (d) {
                                    d.y += d3.event.dy;
                                    return d.y;
                                });
                        }

                        // calculate the current point
                        // 현재 포인트 계산
                        var datum = drag.datum();
                        var currentPoint = {
                            x: datum.x + (datum.width / 2),
                            y: datum.y + (datum.height / 2)
                        };

                        var closestBendIndex = -1;
                        var minDistance;
                        $.each(d.bends, function (i, bend) {
                            var bendPoint = {
                                'x': bend.x,
                                'y': bend.y
                            };

                            // get the distance
                            // 거리를 얻는다.
                            var distance = distanceBetweenPoints(currentPoint, bendPoint);

                            // see if its the minimum
                            // 최소값을 확인하십시오.
                            if (closestBendIndex === -1 || distance < minDistance) {
                                closestBendIndex = i;
                                minDistance = distance;
                            }
                        });

                        // record the closest bend
                        // 가장 가까운 굴곡을 기록합니다.
                        d.labelIndex = closestBendIndex;

                        // refresh the connection
                        d3.select(this.parentNode).call(updateConnections, {
                            'updatePath': true,
                            'updateLabel': false
                        });
                    }
                })
                .on('end', function (d) {
                    if (d.bends.length > 1) {
                        // get the drag selection
                        // 드래그 선택 항목을 가져옵니다.
                        var drag = d3.select('rect.label-drag');

                        // ensure we found a drag selection
                        // 드래그 선택 항목을 찾았는지 확인하십시오.
                        if (!drag.empty()) {
                            // remove the drag selection
                            drag.remove();
                        }

                        // only save if necessary
                        // 필요한 경우 저장하십시오.
                        if (d.labelIndex !== d.component.labelIndex) {
                            // get the connection to refresh below
                            // 아래 새로 고침 할 연결을 얻습니다.
                            var connection = d3.select(this.parentNode);

                            // save the new label index
                            // 새 레이블 인덱스를 저장합니다.
                            save(d, {
                                id: d.id,
                                labelIndex: d.labelIndex
                            }).fail(function () {
                                // restore the previous label index
                                // 이전 레이블 색인을 복원합니다.
                                d.labelIndex = d.component.labelIndex;

                                // refresh the connection
                                connection.call(updateConnections, {
                                    'updatePath': true,
                                    'updateLabel': false
                                });
                            });
                        }
                    }

                    // stop further propagation
                    // 추가 전달 중지
                    d3.event.sourceEvent.stopPropagation();
                });
        },

        /**
         * Adds the specified connection entity.
         * 지정된 연결 엔티티를 추가한다.
         *
         * @param connectionEntities       The connection
         * @param options           Configuration options
         */
        add: function (connectionEntities, options) {
            var selectAll = false;
            if (nfCommon.isDefinedAndNotNull(options)) {
                selectAll = nfCommon.isDefinedAndNotNull(options.selectAll) ? options.selectAll : selectAll;
            }

            // get the current time
            var now = new Date().getTime();

            var add = function (connectionEntity) {
                addedCache.set(connectionEntity.id, now);

                // add the connection
                connectionMap.set(connectionEntity.id, $.extend({
                    type: 'Connection'
                }, connectionEntity));
            };

            // determine how to handle the specified connection
            // 지정된 연결을 처리하는 방법 결정
            if ($.isArray(connectionEntities)) {
                $.each(connectionEntities, function (_, connectionEntity) {
                    add(connectionEntity);
                });
            } else if (nfCommon.isDefinedAndNotNull(connectionEntities)) {
                add(connectionEntities);
            }

            // select
            var selection = select();

            // enter
            var entered = renderConnections(selection.enter(), selectAll);

            // update
            var updated = selection.merge(entered);
            updated.call(updateConnections, {
                'updatePath': true,
                'updateLabel': false
            }).call(sort);
        },

        /**
         * Determines if the specified selection is disconnected from other nodes.
         * 지정된 선택 영역이 다른 노드와 연결되어 있지 않은지 여부를 확인합니다.
         *
         * @argument {selection} selection          The selection
         */
        isDisconnected: function (selection) {

            // if nothing is selected return
            // 아무것도 선택되지 않은 경우 return
            if (selection.empty()) {
                return false;
            }

            var connections = d3.map();
            var components = d3.map();
            var isDisconnected = true;

            // include connections
            // 연결 포함
            selection.filter(function (d) {
                return d.type === 'Connection';
            }).each(function (d) {
                connections.set(d.id, d);
            });

            // include components and ensure their connections are included
            // 구성 요소를 포함하고 연결이 포함되는지 확인합니다.
            selection.filter(function (d) {
                return d.type !== 'Connection';
            }).each(function (d) {
                components.set(d.id, d.component);

                // check all connections of this component
                //이 구성 요소의 모든 연결을 확인합니다.
                $.each(nfConnection.getComponentConnections(d.id), function (_, connection) {
                    if (!connections.has(connection.id)) {
                        isDisconnected = false;
                        return false;
                    }
                });
            });

            if (isDisconnected) {
                // go through each connection to ensure its source and destination are included
                // 각 연결을 통해 소스와 대상이 포함되도록합니다.
                connections.each(function (connection, id) {
                    if (isDisconnected) {
                        // determine whether this connection and its components are included within the selection
                        //이 연결과 해당 구성 요소가 선택 항목에 포함되는지 여부를 확인합니다.
                        isDisconnected = components.has(nfCanvasUtils.getConnectionSourceComponentId(connection)) && components.has(nfCanvasUtils.getConnectionDestinationComponentId(connection));
                    }
                });
            }
            return isDisconnected;
        },

        /**
         * Populates the graph with the specified connections.
         * 지정된 연결로 그래프를 채 웁니다.
         *
         * @argument {object | array} connectionEntities               The connections to add 추가 할 연결
         * @argument {object} options                Configuration options 구성 옵션
         */
        set: function (connectionEntities, options) {
            var selectAll = false;
            var transition = false;
            var overrideRevisionCheck = false;
            if (nfCommon.isDefinedAndNotNull(options)) {
                selectAll = nfCommon.isDefinedAndNotNull(options.selectAll) ? options.selectAll : selectAll;
                transition = nfCommon.isDefinedAndNotNull(options.transition) ? options.transition : transition;
                overrideRevisionCheck = nfCommon.isDefinedAndNotNull(options.overrideRevisionCheck) ? options.overrideRevisionCheck : overrideRevisionCheck;
            }

            var set = function (proposedConnectionEntity) {
                var currentConnectionEntity = connectionMap.get(proposedConnectionEntity.id);

                // set the connection if appropriate due to revision and wasn't previously removed
                // 수정으로 인해 적절한 경우 연결 설정(이전에 제거되지 않음)
                if ((nfClient.isNewerRevision(currentConnectionEntity, proposedConnectionEntity) && !removedCache.has(proposedConnectionEntity.id)) || overrideRevisionCheck === true) {
                    connectionMap.set(proposedConnectionEntity.id, $.extend({
                        type: 'Connection'
                    }, proposedConnectionEntity));
                }
            };

            // determine how to handle the specified connection
            // 지정된 연결을 처리하는 방법 결정
            if ($.isArray(connectionEntities)) {
                $.each(connectionMap.keys(), function (_, key) {
                    var currentConnectionEntity = connectionMap.get(key);
                    var isPresent = $.grep(connectionEntities, function (proposedConnectionEntity) {
                        return proposedConnectionEntity.id === currentConnectionEntity.id;
                    });

                    // if the current connection is not present and was not recently added, remove it
                    // 현재 연결이없고 최근에 추가되지 않은 경우 제거하십시오.
                    if (isPresent.length === 0 && !addedCache.has(key)) {
                        connectionMap.remove(key);
                    }
                });
                $.each(connectionEntities, function (_, connectionEntity) {
                    set(connectionEntity);
                });
            } else if (nfCommon.isDefinedAndNotNull(connectionEntities)) {
                set(connectionEntities);
            }

            // select
            var selection = select();

            // enter
            var entered = renderConnections(selection.enter(), selectAll);

            // update
            var updated = selection.merge(entered);
            updated.call(updateConnections, {
                'updatePath': true,
                'updateLabel': true,
                'transition': transition
            }).call(sort);

            // exit
            selection.exit().call(removeConnections);
        },

        /**
         * Refreshes the connection in the UI.
         * UI에서 연결을 새로 고칩니다.
         *
         * @param {string} connectionId
         */
        refresh: function (connectionId) {
            if (nfCommon.isDefinedAndNotNull(connectionId)) {
                d3.select('#id-' + connectionId).call(updateConnections, {
                    'updatePath': true,
                    'updateLabel': true
                });
            } else {
                d3.selectAll('g.connection').call(updateConnections, {
                    'updatePath': true,
                    'updateLabel': true
                });
            }
        },

        /**
         * Refreshes the components necessary after a pan event.
         * 팬 이벤트 이후에 필요한 구성 요소를 새로 고칩니다.
         */
        pan: function () {
            d3.selectAll('g.connection.entering, g.connection.leaving').call(updateConnections, {
                'updatePath': false,
                'updateLabel': true
            });
        },

        /**
         * Removes the specified connection.
         * 지정한 연결을 제거합니다.
         *
         * @param {array|string} connectionIds      The connection id
         */
        remove: function (connectionIds) {
            var now = new Date().getTime();

            if ($.isArray(connectionIds)) {
                $.each(connectionIds, function (_, connectionId) {
                    removedCache.set(connectionId, now);
                    connectionMap.remove(connectionId);
                });
            } else {
                removedCache.set(connectionIds, now);
                connectionMap.remove(connectionIds);
            }

            // apply the selection and handle all removed connections
            // 선택을 적용하고 제거 된 모든 연결을 처리하십시오.
            select().exit().call(removeConnections);
        },

        /**
         * Removes all processors.
         * 모든 프로세서를 제거합니다.
         */
        removeAll: function () {
            nfConnection.remove(connectionMap.keys());
        },

        /**
         * Reloads the connection state from the server and refreshes the UI.
         * 서버로부터 연결 상태를 다시로드하고 UI를 새로 고칩니다.
         *
         * @param {string} id       The connection id
         */
        reload: function (id) {
            if (connectionMap.has(id)) {
                var connectionEntity = connectionMap.get(id);
                return $.ajax({
                    type: 'GET',
                    url: connectionEntity.uri,
                    dataType: 'json'
                }).done(function (response) {
                    nfConnection.set(response);
                });
            }
        },

        /**
         * Reloads the connection status from the server and refreshes the UI.
         * 서버로부터 연결 상태를 다시로드하고 UI를 새로 고칩니다.
         *
         * @param {string} id       The connection id
         */
        reloadStatus: function (id) {
            if (connectionMap.has(id)) {
                return $.ajax({
                    type: 'GET',
                    url: '../nifi-api/flow/connections/' + encodeURIComponent(id) + '/status',
                    dataType: 'json'
                }).done(function (response) {
                    // update the existing connection
                    // 기존 연결 업데이트
                    var connectionEntity = connectionMap.get(id);
                    connectionEntity.status = response.connectionStatus;
                    connectionMap.set(id, connectionEntity);

                    // update the UI
                    select().call(updateConnectionStatus);
                });
            }
        },

        /**
         * Gets the connection that have a source or destination component with the specified id.
         * 지정된 ID를 사용하여 소스 또는 대상 구성 요소가있는 연결을 가져옵니다.
         *
         * @param {string} id     component id
         * @returns {Array}     components connections
         */
        getComponentConnections: function (id) {
            var connections = [];
            connectionMap.each(function (entry, _) {
                // see if this component is the source or destination of this connection
                // 이 컴퍼넌트가이 접속의 소스 또는 목적지인가 어떤지를 확인한다
                if (nfCanvasUtils.getConnectionSourceComponentId(entry) === id || nfCanvasUtils.getConnectionDestinationComponentId(entry) === id) {
                    connections.push(entry);
                }
            });
            return connections;
        },

        /**
         * If the connection id is specified it is returned. If no connection id
         * specified, all connections are returned.
         * 연결 ID가 지정되면 리턴됩니다. 연결 ID를 지정하지 않으면 모든 연결이 반환됩니다.
         *
         * @param {string} id
         */
        get: function (id) {
            if (nfCommon.isUndefined(id)) {
                return connectionMap.values();
            } else {
                return connectionMap.get(id);
            }
        },

        /**
         * Expires the caches up to the specified timestamp.
         * 지정된 타임 스탬프까지 캐시를 만료시킵니다.
         *
         * @param timestamp
         */
        expireCaches: function (timestamp) {
            var expire = function (cache) {
                cache.each(function (entryTimestamp, id) {
                    if (timestamp > entryTimestamp) {
                        cache.remove(id);
                    }
                });
            };

            expire(addedCache);
            expire(removedCache);
        }
    };

    return nfConnection;
}));