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
                'nf.Connection',
                'nf.ConnectionConfiguration',
                'nf.CanvasUtils'],
            function (d3, nfConnection, nfConnectionConfiguration, nfCanvasUtils) {
                return (nf.Connectable = factory(d3, nfConnection, nfConnectionConfiguration, nfCanvasUtils));
            });
    } else if (typeof exports === 'object' && typeof module === 'object') {
        module.exports = (nf.Connectable =
            factory(require('d3'),
                require('nf.Connection'),
                require('nf.ConnectionConfiguration'),
                require('nf.CanvasUtils')));
    } else {
        nf.Connectable = factory(root.d3,
            root.nf.Connection,
            root.nf.ConnectionConfiguration,
            root.nf.CanvasUtils);
    }
}(this, function (d3, nfConnection, nfConnectionConfiguration, nfCanvasUtils) {
    'use strict';

    var connect;
    var canvas;
    var origin;

    /**
     * Determines if we want to allow adding connections in the current state:
     *
     * 1) When shift is down, we could be adding components to the current selection.
     * 2) When the selection box is visible, we are in the process of moving all the
     * components currently selected.
     * 3) When the drag selection box is visible, we are in the process or selecting components
     * using the selection box.
     *
     * @returns {boolean}
     */
    var allowConnection = function () {
        return !d3.event.shiftKey && d3.select('rect.drag-selection').empty() && d3.select('rect.component-selection').empty();
    };

    return {
        init: function () {
            canvas = d3.select('#canvas');

            // dragging behavior for the connector
            connect = d3.drag()
                .subject(function (d) {
                    origin = d3.mouse(canvas.node());
                    return {
                        x: origin[0],
                        y: origin[1]
                    };
                })
                .on('start', function (d) {
                    // stop further propagation
                    d3.event.sourceEvent.stopPropagation();

                    // unselect the previous components
                    nfCanvasUtils.getSelection().classed('selected', false);

                    // mark the source component has selected
                    var source = d3.select(this.parentNode).classed('selected', true);

                    // mark this component as dragging and selected
                    // 이 구성 요소를 끌기로 표시하고 선택하십시오.
                    d3.select(this).classed('dragging', true);

                    // mark the source of the drag
                    // 끌기의 근원을 표시하다.
                    var sourceData = source.datum();

                    // start the drag line and insert it first to keep it on the bottom
                    // 끌기 선을 시작하고 먼저 삽입하여 맨 아래에 놓습니다.
                    var position = d3.mouse(canvas.node());
                    canvas.insert('path', ':first-child')
                        .datum({
                            'sourceId': sourceData.id,
                            'sourceWidth': sourceData.dimensions.width,
                            'x': position[0],
                            'y': position[1]
                        })
                        .attrs({
                            'class': 'connector',
                            'd': function (pathDatum) {
                                return 'M' + pathDatum.x + ' ' + pathDatum.y + 'L' + pathDatum.x + ' ' + pathDatum.y;
                            }
                        });

                    // updates the location of the connection img
                    // 연결 이미지의 위치를 업데이트하십시오.
                    d3.select(this).attr('transform', function () {
                        return 'translate(' + position[0] + ', ' + (position[1] + 20) + ')';
                    });

                    // re-append the image to keep it on top
                    // 이미지를 다시 적용하여 위에 유지하십시오.
                    canvas.node().appendChild(this);
                })
                .on('drag', function (d) {
                    // updates the location of the connection img
                    // 연결 이미지의 위치를 업데이트하십시오.
                    d3.select(this).attr('transform', function () {
                        return 'translate(' + d3.event.x + ', ' + (d3.event.y + 50) + ')';
                    });

                    // mark node's connectable if supported
                    // 지원되는 경우 노드의 연결 가능 여부 표시
                    var destination = d3.select('g.hover').classed('connectable-destination', function () {
                        // ensure the mouse has moved at least 10px in any direction, it seems that
                        // when the drag event is trigger is not consistent between browsers. as a result
                        // some browser would trigger when the mouse hadn't moved yet which caused
                        // click and contextmenu events to appear like an attempt to connection the
                        // component to itself. requiring the mouse to have actually moved before
                        // checking the eligiblity of the destination addresses the issue
                        // 마우스가 어떤 방향으로 적어도 10px 이동했는지 확인하십시오. 드래그 이벤트가 트리거 될 때 브라우저간에 일관성이없는 것으로 보입니다. 결과적으로 일부 브라우저는 마우스가 아직 이동하지 않았을 때 트리거되어 click 및 contextmenu 이벤트가 구성 요소를 자체에 연결하려는 시도처럼 보이게합니다. 대상의 신분을 확인하기 전에 마우스를 실제로 움직여야 만 문제가 해결됩니다.
                        return (Math.abs(origin[0] - d3.event.x) > 10 || Math.abs(origin[1] - d3.event.y) > 10) &&
                            nfCanvasUtils.isValidConnectionDestination(d3.select(this));
                    });

                    // update the drag line
                    // 끌기 선을 업데이트하십시오.
                    d3.select('path.connector').classed('connectable', function () {
                        if (destination.empty()) {
                            return false;
                        }

                        // if there is a potential destination, see if its connectable
                        // 잠재적 인 목적지가있는 경우 연결 가능한지 확인하십시오.
                        return destination.classed('connectable-destination');
                    }).attr('d', function (pathDatum) {
                        if (!destination.empty() && destination.classed('connectable-destination')) {
                            var destinationData = destination.datum();

                            // show the line preview as appropriate
                            // 적절한 줄 미리보기 표시
                            if (pathDatum.sourceId === destinationData.id) {
                                var x = pathDatum.x;
                                var y = pathDatum.y;
                                var componentOffset = pathDatum.sourceWidth / 2;
                                var xOffset = nfConnection.config.selfLoopXOffset;
                                var yOffset = nfConnection.config.selfLoopYOffset;
                                return 'M' + x + ' ' + y + 'L' + (x + componentOffset + xOffset) + ' ' + (y - yOffset) + 'L' + (x + componentOffset + xOffset) + ' ' + (y + yOffset) + 'Z';
                            } else {
                                // get the position on the destination perimeter
                                // 목적지 경계에서 위치를 얻는다.
                                var end = nfCanvasUtils.getPerimeterPoint(pathDatum, {
                                    'x': destinationData.position.x,
                                    'y': destinationData.position.y,
                                    'width': destinationData.dimensions.width,
                                    'height': destinationData.dimensions.height
                                });

                                // direct line between components to provide a 'snap feel'
                                // 구성 요소들 사이의 직선은 '스냅 느낌'을 제공합니다.
                                return 'M' + pathDatum.x + ' ' + pathDatum.y + 'L' + end.x + ' ' + end.y;
                            }
                        } else {
                            return 'M' + pathDatum.x + ' ' + pathDatum.y + 'L' + d3.event.x + ' ' + d3.event.y;
                        }
                    });
                })
                .on('end', function (d) {
                    // stop further propagation
                    d3.event.sourceEvent.stopPropagation();

                    // get the add connect img
                    // 추가 연결 img 가져 오기
                    var addConnect = d3.select(this);

                    // get the connector, if it the current point is not over a new destination
                    // the connector will be removed. otherwise it will be removed after the
                    // connection has been configured/cancelled
                    // 커넥터를 가져옵니다. 현재 지점이 새 대상 위에 있지 않으면 커넥터가 제거됩니다. 그렇지 않으면 연결이 구성되거나 취소 된 후에 제거됩니다.
                    var connector = d3.select('path.connector');
                    var connectorData = connector.datum();

                    // get the destination
                    var destination = d3.select('g.connectable-destination');

                    // we are not over a new destination
                    // 우리는 새로운 목적지를 넘어서지 않았다.
                    if (destination.empty()) {
                        // get the source to determine if we are still over it
                        // 우리가 아직 그것을 극복하지 못했는지를 판단하기 위해 출처를 얻다
                        var source = d3.select('#id-' + connectorData.sourceId);
                        var sourceData = source.datum();

                        // get the mouse position relative to the source
                        var position = d3.mouse(source.node());

                        // if the position is outside the component, remove the add connect img
                        // 위치가 구성 요소 외부에 있는 경우 추가 연결 img를 제거하십시오.
                        if (position[0] < 0 || position[0] > sourceData.dimensions.width || position[1] < 0 || position[1] > sourceData.dimensions.height) {
                            addConnect.remove();
                        } else {
                            // reset the add connect img by restoring the position and place in the DOM
                            // DOM에 위치와 위치를 복원하여 연결 추가 img 재설정
                            addConnect.classed('dragging', false).attr('transform', function () {
                                return 'translate(' + d.origX + ', ' + d.origY + ')';
                            });
                            source.node().appendChild(this);
                        }

                        // remove the connector
                        connector.remove();
                    } else {
                        // remove the add connect img
                        addConnect.remove();

                        // create the connection
                        var destinationData = destination.datum();
                        nfConnectionConfiguration.createConnection(connectorData.sourceId, destinationData.id);
                    }
                });
        },

        /**
         * Activates the connect behavior for the components in the specified selection.
         * 지정된 선택사항의 구성요소에 대한 연결 동작을 활성화합니다.
         *
         * @param {selection} components
         */
        activate: function (components) {
            components
                .classed('connectable', true)
                .on('mouseenter.connectable', function (d) {
                    if (allowConnection()) {
                        var selection = d3.select(this);

                        // ensure the current component supports connection source
                        // 현재 구성 요소가 연결 소스를 지원하는지 확인하십시오.
                        if (nfCanvasUtils.isValidConnectionSource(selection)) {
                            // see if theres already a connector rendered
                            // 커넥터가 이미 렌더링되었는지 확인하십시오.
                            var addConnect = d3.select('text.add-connect');
                            if (addConnect.empty()) {
                                var x = (d.dimensions.width / 2) - 14;
                                var y = (d.dimensions.height / 2) + 14;

                                selection.append('text')
                                    .datum({
                                        origX: x,
                                        origY: y
                                    })
                                    .call(connect)
                                    .attrs({
                                        'class': 'add-connect',
                                        'transform': 'translate(' + x + ', ' + y + ')'
                                    })
                                    .text('\ue834');
                            }
                        }
                    }
                })
                .on('mouseleave.connectable', function () {
                    // conditionally remove the connector
                    // 커넥터를 조건부로 제거하다
                    var addConnect = d3.select(this).select('text.add-connect');
                    if (!addConnect.empty() && !addConnect.classed('dragging')) {
                        addConnect.remove();
                    }
                })
                // Using mouseover/out to workaround chrome issue #122746
                .on('mouseover.connectable', function () {
                    // mark that we are hovering when appropriate
                    d3.select(this).classed('hover', function () {
                        return allowConnection();
                    });
                })
                .on('mouseout.connection', function () {
                    // remove all hover related classes
                    d3.select(this).classed('hover connectable-destination', false);
                });
        },

        /**
         * Deactivates the connect behavior for the components in the specified selection.
         *
         * @param {selection} components
         */
        deactivate: function (components) {
            components
                .classed('connectable', false)
                .on('mouseenter.connectable', null)
                .on('mouseleave.connectable', null)
                .on('mouseover.connectable', null)
                .on('mouseout.connectable', null);
        }
    };
}));