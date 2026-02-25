import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Search, Ticket, UserPlus, X } from 'lucide-react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { toast } from 'sonner';

import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '~/components/ui/command';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Switch } from './ui/switch';

export type Participant = {
  type: 'user' | 'temp-phone' | 'temp-code';
  id: string;
  name: string;
  detail: string;
  maxUses?: number | null;
  expiryOption?: 'event_end' | 'one_day' | 'three_days' | 'custom';
  customExpiryDate?: string | null;
};

type User = {
  id: string;
  name: string;
  phoneNumber: string;
};

export function ParticipantManager({
  participants,
  setParticipants,
}: {
  participants: Participant[];
  setParticipants: (participants: Participant[]) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pendingTempPhone, setPendingTempPhone] = useState<{ phone: string; name: string } | null>(null);

  const [expiryOption, setExpiryOption] = useState<Participant['expiryOption']>('one_day');
  const [customExpiryDate, setCustomExpiryDate] = useState<Date | null>(new Date());
  const [tempCodeMaxUses, setTempCodeMaxUses] = useState<number | null>(1);
  const [isUnlimited, setIsUnlimited] = useState(false);

  const searchFetcher = useFetcher<{ users: User[] }>();
  const phoneCheckFetcher = useFetcher<{ exists: boolean; isUser: boolean }>();

  const addParticipant = (participant: Participant) => {
    if (participants.some((existing) => existing.type === participant.type && existing.id === participant.id)) {
      toast.warning('이미 추가된 참가자입니다.');
      return;
    }

    setParticipants([...participants, participant]);
    setSearchQuery('');
  };

  const removeParticipant = (type: Participant['type'], id: string) => {
    setParticipants(participants.filter((participant) => !(participant.type === type && participant.id === id)));
  };

  const handleSearch = () => {
    const query = searchQuery.trim();
    if (query.length < 2) {
      toast.info('검색어를 2글자 이상 입력해주세요.');
      return;
    }

    searchFetcher.load(`/api/users/search?q=${encodeURIComponent(query)}`);
  };

  const addTempUserByPhone = () => {
    const cleanPhone = phone.trim().replace(/-/g, '');
    const cleanName = name.trim();

    if (!/^\d{10,11}$/.test(cleanPhone)) {
      toast.error('올바른 전화번호 형식을 입력해주세요.');
      return;
    }

    if (participants.some((participant) => participant.type === 'temp-phone' && participant.id === cleanPhone)) {
      toast.warning('이미 추가된 참가자입니다.');
      return;
    }

    setPendingTempPhone({ phone: cleanPhone, name: cleanName });
    phoneCheckFetcher.load(`/api/users/check?phone=${cleanPhone}`);
  };

  useEffect(() => {
    if (phoneCheckFetcher.state !== 'idle' || !phoneCheckFetcher.data || !pendingTempPhone) {
      return;
    }

    if (phoneCheckFetcher.data.exists) {
      toast.error('이미 등록된 회원입니다. 상단의 회원 검색을 이용해주세요.');
    } else {
      addParticipant({
        type: 'temp-phone',
        id: pendingTempPhone.phone,
        name: pendingTempPhone.name || `임시회원-${pendingTempPhone.phone.slice(-4)}`,
        detail: pendingTempPhone.phone,
      });
    }

    setName('');
    setPhone('');
    setPendingTempPhone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneCheckFetcher.data, phoneCheckFetcher.state, pendingTempPhone]);

  const addTempUserByCode = () => {
    if (expiryOption === 'custom' && !customExpiryDate) {
      toast.error('직접 지정 만료일을 선택해주세요.');
      return;
    }

    const code = `CODE-${Date.now().toString(36).toUpperCase()}`;

    addParticipant({
      type: 'temp-code',
      id: code,
      name: '임시 코드 발급',
      detail: `최대 ${isUnlimited ? '무제한' : `${tempCodeMaxUses}회`} 사용`,
      maxUses: isUnlimited ? null : tempCodeMaxUses,
      expiryOption,
      customExpiryDate: expiryOption === 'custom' && customExpiryDate ? customExpiryDate.toISOString() : null,
    });
  };

  useEffect(() => {
    if (isUnlimited) {
      setTempCodeMaxUses(null);
      return;
    }

    if (tempCodeMaxUses === null) {
      setTempCodeMaxUses(1);
    }
  }, [isUnlimited, tempCodeMaxUses]);

  return (
    <div className="space-y-4">
      <div className="p-4 border rounded-lg space-y-2 min-h-[80px]">
        {participants.map((participant) => (
          <Badge key={`${participant.type}-${participant.id}`} variant="secondary" className="mr-2 mb-2 text-xs">
            {participant.name} ({participant.detail})
            <button
              type="button"
              onClick={() => removeParticipant(participant.type, participant.id)}
              className="ml-2 rounded-full hover:bg-muted p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {participants.length === 0 && (
          <p className="text-sm text-muted-foreground">아래에서 참가자를 추가해주세요.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label>회원 검색</Label>
        <div className="flex gap-2">
          <Input
            placeholder="이름 또는 전화번호로 검색"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSearch();
              }
            }}
          />
          <Button type="button" onClick={handleSearch}>
            <Search className="h-4 w-4" />
          </Button>
        </div>

        {searchFetcher.state !== 'idle' || searchFetcher.data ? (
          <Command className="rounded-lg border shadow-md mt-2">
            <CommandList>
              <CommandEmpty>검색 결과가 없습니다.</CommandEmpty>
              {searchFetcher.state === 'loading' && <div className="p-4 text-sm">검색 중...</div>}
              {searchFetcher.data?.users && (
                <CommandGroup className="text-xs" heading="검색된 회원">
                  {searchFetcher.data.users.map((user) => (
                    <CommandItem
                      key={user.id}
                      onSelect={() =>
                        addParticipant({
                          type: 'user',
                          id: user.id,
                          name: user.name,
                          detail: user.phoneNumber,
                        })
                      }
                    >
                      {user.name} ({user.phoneNumber})
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        ) : null}
      </div>

      <div className="space-y-2">
        <Label>비회원 등록</Label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="이름 (선택)" />
          <Input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="전화번호 (필수)"
          />
        </div>
        <Button
          type="button"
          onClick={addTempUserByPhone}
          className="w-full"
          disabled={phoneCheckFetcher.state !== 'idle'}
        >
          {phoneCheckFetcher.state !== 'idle' ? (
            '확인 중...'
          ) : (
            <>
              <UserPlus className="mr-2 h-4 w-4" />
              전화번호로 추가
            </>
          )}
        </Button>
      </div>

      <div className="space-y-2 mt-4 border-t pt-4">
        <Label className="font-semibold">임시 스탬프 코드 발급</Label>
        <div className="flex items-center gap-2 mt-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="w-[120px] justify-start">
                {isUnlimited ? '무제한' : `${tempCodeMaxUses}회`}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="unlimited-switch">무제한 사용</Label>
                <Switch id="unlimited-switch" checked={isUnlimited} onCheckedChange={setIsUnlimited} />
              </div>

              {!isUnlimited && (
                <div>
                  <Label htmlFor="max-uses-input">사용 횟수</Label>
                  <Input
                    id="max-uses-input"
                    type="number"
                    min="1"
                    value={tempCodeMaxUses ?? 1}
                    onChange={(event) => {
                      const parsed = Number.parseInt(event.target.value, 10);
                      setTempCodeMaxUses(Number.isNaN(parsed) || parsed < 1 ? 1 : parsed);
                    }}
                  />
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Select
            value={expiryOption}
            onValueChange={(value) => setExpiryOption(value as Participant['expiryOption'])}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="유효기간 선택..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="event_end">이벤트 종료일</SelectItem>
              <SelectItem value="one_day">종료일 +1일</SelectItem>
              <SelectItem value="three_days">종료일 +3일</SelectItem>
              <SelectItem value="custom">직접 지정</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {expiryOption === 'custom' && (
          <div className="mt-2">
            <DatePicker
              label="만료 날짜 선택"
              value={customExpiryDate}
              onChange={(newValue) => setCustomExpiryDate(newValue as Date | null)}
              minDate={new Date()}
              slotProps={{ textField: { fullWidth: true, size: 'small' } }}
            />
          </div>
        )}

        <Button type="button" onClick={addTempUserByCode} className="flex-grow">
          <Ticket className="mr-2 h-4 w-4" />
          임시 스탬프 코드 발급 및 추가
        </Button>
      </div>
    </div>
  );
}
