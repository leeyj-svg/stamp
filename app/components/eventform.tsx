import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { UploadCloud, X } from "lucide-react";
import { toast } from "sonner";

import { CategoryDialog } from "~/components/categoryDialog";
import { ParticipantManager, type Participant } from "~/components/participantManager";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";

const eventFormSchema = z
  .object({
    name: z.string().min(2, "이벤트명은 2자 이상이어야 합니다."),
    description: z.string().optional(),
    newImages: z.unknown().optional(),
    isAllDay: z.boolean(),
    categoryId: z.string().min(1, "카테고리를 선택해 주세요."),
    startDate: z.date(),
    endDate: z.date(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "종료일은 시작일보다 빠를 수 없습니다.",
    path: ["endDate"],
  });

type EventFormValues = z.infer<typeof eventFormSchema>;

type EventImage = {
  id: number;
  url: string;
  eventId: string;
};

type EventFormFetcher = {
  state: "idle" | "submitting" | "loading";
  submit: (target: FormData, options: { method: "post"; encType: "multipart/form-data" }) => void;
};

type EventFormDefaultValues = {
  name: string;
  description?: string | null;
  categoryId: string | number;
  isAllDay: boolean;
  startDate: string | Date;
  endDate: string | Date;
  images?: EventImage[];
  participants?: Participant[];
};

type EventFormProps = {
  fetcher: EventFormFetcher;
  categories: { id: number; name: string }[];
  defaultValues?: EventFormDefaultValues;
};

const MAX_IMAGES = 10;

export function EventForm({ fetcher, categories, defaultValues }: EventFormProps) {
  const isEditing = Boolean(defaultValues);
  const [existingImages, setExistingImages] = useState<EventImage[]>([]);
  const [newImageFiles, setNewImageFiles] = useState<File[]>([]);
  const [newImagePreviews, setNewImagePreviews] = useState<string[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);

  const form = useForm<EventFormValues>({
    resolver: zodResolver(eventFormSchema),
    defaultValues: isEditing && defaultValues
      ? {
          name: defaultValues.name,
          description: defaultValues.description ?? "",
          categoryId: String(defaultValues.categoryId),
          isAllDay: defaultValues.isAllDay,
          startDate: new Date(defaultValues.startDate),
          endDate: new Date(defaultValues.endDate),
        }
      : {
          name: "",
          description: "",
          categoryId: "",
          isAllDay: true,
          startDate: new Date(),
          endDate: new Date(),
        },
  });

  useEffect(() => {
    if (!isEditing || !defaultValues) {
      return;
    }

    setParticipants(defaultValues.participants ?? []);
    setExistingImages(defaultValues.images ?? []);
  }, [defaultValues, isEditing]);

  useEffect(() => {
    return () => {
      newImagePreviews.forEach((preview) => URL.revokeObjectURL(preview));
    };
  }, [newImagePreviews]);

  const isAllDay = form.watch("isAllDay");
  const totalImageCount = existingImages.length + newImageFiles.length;
  const isSubmitting = fetcher.state !== "idle";

  const handleNewImageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    const nextCount = existingImages.length + newImageFiles.length + files.length;
    if (nextCount > MAX_IMAGES) {
      toast.error(`이미지는 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`);
      return;
    }

    const previews = files.map((file) => URL.createObjectURL(file));
    setNewImageFiles((prev) => [...prev, ...files]);
    setNewImagePreviews((prev) => [...prev, ...previews]);
    event.target.value = "";
  };

  const handleDeleteExistingImage = (idToDelete: number) => {
    setExistingImages((prev) => prev.filter((image) => image.id !== idToDelete));
  };

  const handleDeleteNewImage = (indexToDelete: number) => {
    setNewImageFiles((prev) => prev.filter((_, index) => index !== indexToDelete));
    setNewImagePreviews((prev) => {
      const next = [...prev];
      const [removed] = next.splice(indexToDelete, 1);
      if (removed) {
        URL.revokeObjectURL(removed);
      }
      return next;
    });
  };

  const onSubmit = (data: EventFormValues) => {
    if (participants.length === 0) {
      toast.error("참여자를 한 명 이상 추가해 주세요.");
      return;
    }

    const formData = new FormData();
    formData.append("name", data.name);
    if (data.description) {
      formData.append("description", data.description);
    }
    formData.append("categoryId", data.categoryId);
    formData.append("isAllDay", String(data.isAllDay));
    formData.append("startDate", data.startDate.toISOString());
    formData.append("endDate", data.endDate.toISOString());
    formData.append("participants", JSON.stringify(participants));

    if (isEditing) {
      formData.append("existingImageIds", JSON.stringify(existingImages.map((image) => image.id)));
      newImageFiles.forEach((file) => formData.append("newImages", file));
    } else {
      newImageFiles.forEach((file) => formData.append("images", file));
    }

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-0">
      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "이벤트 수정" : "이벤트 생성"}</CardTitle>
          <CardDescription>
            {isEditing ? "이벤트 정보와 참여자를 수정합니다." : "새 이벤트를 만들고 참여자를 지정합니다."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>이벤트명</FormLabel>
                    <FormControl>
                      <Input placeholder="스탬프 챌린지 이벤트" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="newImages"
                render={() => (
                  <FormItem>
                    <FormLabel>이미지 (최대 {MAX_IMAGES}장)</FormLabel>
                    <FormControl>
                      <div className="flex items-center gap-4">
                        <div className="flex flex-wrap gap-2">
                          {existingImages.map((image) => (
                            <div key={image.id} className="relative h-24 w-24 overflow-hidden rounded-lg border">
                              <img src={image.url} alt={`Existing image ${image.id}`} className="h-full w-full object-cover" />
                              <button
                                type="button"
                                onClick={() => handleDeleteExistingImage(image.id)}
                                className="absolute right-0 top-0 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                          {newImagePreviews.map((src, index) => (
                            <div key={src} className="relative h-24 w-24 overflow-hidden rounded-lg border">
                              <img src={src} alt={`Preview ${index + 1}`} className="h-full w-full object-cover" />
                              <button
                                type="button"
                                onClick={() => handleDeleteNewImage(index)}
                                className="absolute right-0 top-0 rounded-full bg-red-500 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ))}
                          {totalImageCount < MAX_IMAGES && (
                            <Label
                              htmlFor="picture"
                              className="flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-muted/40 hover:bg-muted"
                            >
                              <UploadCloud className="h-8 w-8 text-muted-foreground" />
                              <span className="mt-1 text-xs text-muted-foreground">추가</span>
                            </Label>
                          )}
                        </div>
                        <Input
                          id="picture"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={handleNewImageChange}
                          className="hidden"
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>카테고리</FormLabel>
                    <div className="flex gap-2">
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="카테고리를 선택해 주세요" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={String(category.id)}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <CategoryDialog categories={categories} />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="isAllDay"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <FormLabel className="text-base">종일 일정</FormLabel>
                      <FormDescription>
                        날짜만 선택하려면 켜고, 시간까지 지정하려면 꺼 주세요.
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={() => (
                    <FormItem className="flex flex-col">
                      <FormLabel>시작 {isAllDay ? "날짜" : "일시"}</FormLabel>
                      <FormControl>
                        <Controller
                          control={form.control}
                          name="startDate"
                          render={({ field: { onChange, value } }) => (
                            <DateTimePicker
                              value={value ?? null}
                              onChange={onChange}
                              ampm={false}
                              label={isAllDay ? "날짜 선택" : "날짜와 시간 선택"}
                              views={isAllDay ? ["year", "month", "day"] : ["year", "month", "day", "hours", "minutes"]}
                              slotProps={{ textField: { fullWidth: true, variant: "outlined", size: "small" } }}
                            />
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={() => (
                    <FormItem className="flex flex-col">
                      <FormLabel>종료 {isAllDay ? "날짜" : "일시"}</FormLabel>
                      <FormControl>
                        <Controller
                          control={form.control}
                          name="endDate"
                          render={({ field: { onChange, value } }) => (
                            <DateTimePicker
                              value={value ?? null}
                              onChange={onChange}
                              ampm={false}
                              label={isAllDay ? "날짜 선택" : "날짜와 시간 선택"}
                              views={isAllDay ? ["year", "month", "day"] : ["year", "month", "day", "hours", "minutes"]}
                              slotProps={{ textField: { fullWidth: true, variant: "outlined", size: "small" } }}
                            />
                          )}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>설명</FormLabel>
                    <FormControl>
                      <Textarea placeholder="이벤트 설명을 입력해 주세요" className="resize-none" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormItem>
                <FormLabel>참여자</FormLabel>
                <ParticipantManager participants={participants} setParticipants={setParticipants} />
              </FormItem>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (isEditing ? "저장 중..." : "생성 중...") : (isEditing ? "이벤트 저장" : "이벤트 생성")}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
