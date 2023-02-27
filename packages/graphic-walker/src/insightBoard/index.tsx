import { toJS } from "mobx";
import { observer } from "mobx-react-lite";
import React, { useCallback } from "react";
import Modal from "../components/modal";
import { useGlobalStore } from "../store";
import InsightMainBoard from "./mainBoard";

const InsightBoard: React.FC = (props) => {
    const { commonStore, vizStore } = useGlobalStore();
    const { showInsightBoard, currentDataset, filters } = commonStore;
    const { viewDimensions, viewMeasures, draggableFieldState } = vizStore;
    const onCloseModal = useCallback(() => {
        commonStore.setShowInsightBoard(false);
    }, []);
    if (!showInsightBoard) {
        return null;
    }
    return (
        <Modal onClose={onCloseModal} show={showInsightBoard}>
            <InsightMainBoard
                dataSource={currentDataset.dataSource}
                fields={toJS(draggableFieldState.fields)}
                viewDs={viewDimensions}
                viewMs={viewMeasures}
                filters={toJS(filters)}
            />
        </Modal>
    );
};

export default observer(InsightBoard);
