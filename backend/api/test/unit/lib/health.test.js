import React, { useState } from 'react';

// Example inside your ItemRow or DeleteButton component
export function DeleteItemComponent({ itemId, onDeleteConfirm }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const handleDeleteClick = () => {
    setIsDialogOpen(true);
  };

  const handleCancel = () => {
    setIsDialogOpen(false);
  };

  const handleConfirmDelete = async () => {
    setIsDialogOpen(false);
    // Proceed with the existing deletion logic passed down via props
    await onDeleteConfirm(itemId);
  };

  return (
    <>
      <button onClick={handleDeleteClick} className="btn-delete">
        Delete
      </button>

      {isDialogOpen && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <h3>Delete Item?</h3>
            <p>This action will permanently remove this item. Are you sure you want to proceed?</p>
            
            <div className="modal-actions">
              <button onClick={handleCancel} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleConfirmDelete} className="btn-danger">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
