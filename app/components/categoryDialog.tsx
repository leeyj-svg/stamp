import { useEffect, useRef, useState } from 'react';
import { useFetcher, useRevalidator } from 'react-router';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';

type Category = {
  id: number;
  name: string;
};

type CategoryActionData = {
  success?: boolean;
  error?: string;
};

export function CategoryDialog({ categories }: { categories: Category[] }) {
  const [newCategoryName, setNewCategoryName] = useState('');
  const addFetcher = useFetcher<CategoryActionData>();
  const deleteFetcher = useFetcher<CategoryActionData>();
  const revalidator = useRevalidator();
  const inputRef = useRef<HTMLInputElement>(null);

  const isAdding = addFetcher.state !== 'idle';
  const isDeleting = deleteFetcher.state !== 'idle';

  useEffect(() => {
    if (addFetcher.state !== 'idle' || !addFetcher.data) {
      return;
    }

    if (addFetcher.data.success) {
      toast.success('카테고리를 추가했습니다.');
      setNewCategoryName('');
      revalidator.revalidate();
      inputRef.current?.focus();
      return;
    }

    if (addFetcher.data.error) {
      toast.error(addFetcher.data.error);
    }
  }, [addFetcher.state, addFetcher.data, revalidator]);

  useEffect(() => {
    if (deleteFetcher.state !== 'idle' || !deleteFetcher.data) {
      return;
    }

    if (deleteFetcher.data.success) {
      toast.success('카테고리를 삭제했습니다.');
      revalidator.revalidate();
      return;
    }

    if (deleteFetcher.data.error) {
      toast.error(deleteFetcher.data.error);
    }
  }, [deleteFetcher.state, deleteFetcher.data, revalidator]);

  const handleDelete = (categoryId: number) => {
    const formData = new FormData();
    formData.append('id', String(categoryId));
    deleteFetcher.submit(formData, { method: 'delete', action: '/api/categories' });
  };

  const handleAdd = () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      toast.warning('카테고리 이름을 입력해주세요.');
      inputRef.current?.focus();
      return;
    }

    const formData = new FormData();
    formData.append('name', trimmed);
    addFetcher.submit(formData, { method: 'post', action: '/api/categories' });
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          관리
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>카테고리 관리</DialogTitle>
          <DialogDescription className="text-xs mt-2 text-muted-foreground">
            새 카테고리를 추가하거나 기존 카테고리를 삭제할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-4 max-h-60 overflow-y-auto">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center justify-between">
              <span>{category.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => handleDelete(category.id)}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-category-name">새 카테고리 이름</Label>
          <div className="flex gap-2">
            <Input
              id="new-category-name"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              ref={inputRef}
              disabled={isAdding}
            />
            <Button type="button" onClick={handleAdd} disabled={isAdding}>
              {isAdding ? '추가 중...' : '추가'}
            </Button>
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              닫기
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
