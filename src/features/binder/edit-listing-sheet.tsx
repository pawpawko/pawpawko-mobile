import { Alert } from 'react-native';

import { type ListingType } from '@/lib/binder-constants';
import { ListingFormSheet } from './listing-form-sheet';
import { type CardInfo, type Listing } from './types';

export type EditListingSheetProps = {
  listing: Listing | null;
  card: CardInfo | undefined;
  onClose: () => void;
  onSave: (l: Listing, qty: number, ltype: ListingType) => Promise<void>;
  onRemove: (l: Listing) => Promise<void>;
  isWishlist: boolean;
};

export function EditListingSheet({
  listing,
  card,
  onClose,
  onSave,
  onRemove,
  isWishlist,
}: EditListingSheetProps) {
  if (!listing) return null;
  return (
    <ListingFormSheet
      visible={!!listing}
      title={isWishlist ? 'WISHLIST CARD' : 'EDIT LISTING'}
      card={card}
      initialQty={listing.quantity}
      initialType={listing.listing_type as ListingType}
      hideForm={isWishlist}
      onClose={onClose}
      onSave={async (qty, ltype) => {
        await onSave(listing, qty, ltype);
      }}
      onDestroy={async () => {
        Alert.alert(
          isWishlist ? 'Remove from wishlist?' : 'Remove this listing?',
          '',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove', style: 'destructive', onPress: () => onRemove(listing) },
          ],
        );
      }}
      destroyLabel={isWishlist ? 'REMOVE FROM WISHLIST' : 'REMOVE LISTING'}
    />
  );
}
